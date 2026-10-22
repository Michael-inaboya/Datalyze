import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "./secrets";
import { chargesToSales, type StripeCharge } from "./stripe";
import { isoDay } from "./format";

const API = "https://api.stripe.com/v1";
const MAX_CHARGES = 50_000;

async function stripeGet<T>(key: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message ?? `Stripe returned ${res.status}`;
    throw new StripeError(res.status, msg);
  }
  return body as T;
}

export class StripeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Checks the key can read charges and returns a display name for the account, when the key may read it. */
export async function checkKey(key: string): Promise<string | null> {
  await stripeGet(key, "/charges?limit=1");
  try {
    const acct = await stripeGet<{ settings?: { dashboard?: { display_name?: string } }; business_profile?: { name?: string } }>(key, "/account");
    return acct.business_profile?.name || acct.settings?.dashboard?.display_name || null;
  } catch {
    return null;
  }
}

/** Every charge created after the given Unix time, newest first. */
async function chargesSince(key: string, after: number): Promise<StripeCharge[]> {
  const out: StripeCharge[] = [];
  let cursor = "";
  for (;;) {
    const page = await stripeGet<{ data: StripeCharge[]; has_more: boolean }>(
      key,
      `/charges?limit=100&created[gt]=${after}${cursor ? `&starting_after=${cursor}` : ""}`,
    );
    out.push(...page.data);
    if (!page.has_more || !page.data.length || out.length >= MAX_CHARGES) return out;
    cursor = page.data[page.data.length - 1].id;
  }
}

export type SyncResult = { added: number; otherCurrency: number; alreadyHad: number };

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** Pulls new Stripe payments into the business's sales. Runs as the signed-in owner, so RLS applies. */
export async function syncStripe(db: SupabaseClient, businessId: string): Promise<SyncResult> {
  const biz = check(await db.from("businesses").select("currency").eq("id", businessId).single()) as { currency: string };
  const conn = check(
    await db.from("connections").select("id, secret, synced_until").eq("business_id", businessId).eq("provider", "stripe").maybeSingle(),
  ) as { id: string; secret: string; synced_until: number } | null;
  if (!conn) throw new Error("Stripe isn't connected for this business.");

  try {
    const charges = await chargesSince(decryptSecret(conn.secret), Number(conn.synced_until));
    const newest = charges.reduce((m, c) => Math.max(m, c.created), Number(conn.synced_until));
    const { rows, otherCurrency } = chargesToSales(charges, biz.currency);

    // Skip payments already in Datalyze, for example from an earlier Stripe CSV upload.
    const seen = new Set<string>();
    const ids = rows.map((r) => r.order!).filter(Boolean);
    for (let i = 0; i < ids.length; i += 200) {
      const found = check(
        await db.from("sales").select("order_ref").eq("business_id", businessId).in("order_ref", ids.slice(i, i + 200)),
      ) as { order_ref: string }[];
      found.forEach((f) => seen.add(f.order_ref));
    }
    const fresh = rows.filter((r) => !seen.has(r.order!));

    if (fresh.length) {
      const stamp = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      const imp = check(
        await db
          .from("imports")
          .insert({ business_id: businessId, kind: "sales", file_name: `Stripe sync, ${stamp}`, source: "Stripe connection", row_count: fresh.length, skipped: otherCurrency, connection_id: conn.id })
          .select("id")
          .single(),
      ) as { id: string };
      try {
        for (let i = 0; i < fresh.length; i += 1000) {
          check(
            await db.from("sales").insert(
              fresh.slice(i, i + 1000).map((r) => ({
                business_id: businessId, import_id: imp.id, sold_on: isoDay(r.date), customer: r.customer,
                product: r.product, quantity: r.quantity, amount: r.amount, order_ref: r.order,
              })),
            ),
          );
        }
      } catch (e) {
        await db.from("imports").delete().eq("id", imp.id);
        throw e;
      }
    }
    check(await db.from("connections").update({ synced_until: newest, last_synced_at: new Date().toISOString(), last_error: null }).eq("id", conn.id));
    return { added: fresh.length, otherCurrency, alreadyHad: rows.length - fresh.length };
  } catch (e) {
    const message = e instanceof StripeError && (e.status === 401 || e.status === 403)
      ? "Stripe no longer accepts this key. Create a new restricted key and reconnect."
      : e instanceof Error ? e.message : "Sync failed.";
    await db.from("connections").update({ last_error: message }).eq("id", conn.id);
    throw new Error(message);
  }
}
