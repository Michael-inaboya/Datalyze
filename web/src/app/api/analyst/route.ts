import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { askAnalyst, validTurns, type AnalystData } from "@/lib/analyst";
import { SAMPLE_NAME, sampleBusiness } from "@/lib/sample";
import { supabaseStore } from "@/lib/store";
import { serverSupabase } from "@/lib/supabase/server";
import type { Currency } from "@/lib/types";

export const maxDuration = 300;

// Best effort: each server instance keeps its own count, which is enough to stop casual overuse of the demo.
const DEMO_LIMIT = 15;
const DEMO_WINDOW = 3600_000;
const demoHits = new Map<string, number[]>();
function demoAllowed(ip: string) {
  const now = Date.now();
  const hits = (demoHits.get(ip) ?? []).filter((t) => t > now - DEMO_WINDOW);
  if (hits.length >= DEMO_LIMIT) return false;
  hits.push(now);
  demoHits.set(ip, hits);
  return true;
}

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) return fail("The AI analyst isn't switched on for this site yet.", 503);
  const body = (await request.json().catch(() => ({}))) as { businessId?: string; turns?: unknown };
  const turns = validTurns(body.turns);
  if (!body.businessId || !turns) return fail("That question couldn't be read. Try asking again.", 400);

  let data: AnalystData;
  if (body.businessId === "demo") {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    if (!demoAllowed(ip)) return fail("The demo allows a few questions an hour. Sign up to ask about your own data.", 429);
    data = { name: SAMPLE_NAME, currency: "USD", ...sampleBusiness() };
  } else {
    const db = await serverSupabase();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return fail("Your session has ended. Sign in again.", 401);
    const { data: biz } = await db.from("businesses").select("name, currency").eq("id", body.businessId).maybeSingle();
    if (!biz) return fail("That business wasn't found.", 404);
    const store = supabaseStore(db);
    const [sales, expenses] = await Promise.all([store.loadSales(body.businessId), store.loadExpenses(body.businessId)]);
    data = { name: biz.name as string, currency: biz.currency as Currency, sales, expenses };
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await askAnalyst(data, turns, (text) => controller.enqueue(encoder.encode(text)), request.signal);
      } catch (e) {
        if (!request.signal.aborted) {
          console.error("analyst", e);
          const busy = e instanceof Anthropic.RateLimitError || (e instanceof Anthropic.APIError && e.status === 529);
          controller.enqueue(encoder.encode(busy ? "\n\nThe analyst is busy right now. Try again in a minute." : "\n\nSomething went wrong answering that. Try again."));
        }
      }
      try { controller.close(); } catch {}
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
