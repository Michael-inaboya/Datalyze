import { NextResponse, type NextRequest } from "next/server";
import { syncStripe } from "@/lib/stripeApi";
import { serverSupabase } from "@/lib/supabase/server";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const { businessId } = (await request.json().catch(() => ({}))) as { businessId?: string };
  if (!businessId) return NextResponse.json({ error: "Missing business." }, { status: 400 });
  const db = await serverSupabase();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Your session has ended. Sign in again." }, { status: 401 });
  try {
    return NextResponse.json(await syncStripe(db, businessId));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
