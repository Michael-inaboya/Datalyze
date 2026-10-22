import { NextResponse, type NextRequest } from "next/server";
import { encryptSecret } from "@/lib/secrets";
import { isRestrictedKey } from "@/lib/stripe";
import { checkKey, StripeError, syncStripe } from "@/lib/stripeApi";
import { serverSupabase } from "@/lib/supabase/server";

export const maxDuration = 300;

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/** Connect a Stripe account with a restricted key, then run the first sync. */
export async function POST(request: NextRequest) {
  const { businessId, key } = (await request.json().catch(() => ({}))) as { businessId?: string; key?: string };
  if (!businessId || !key) return fail(400, "Paste your Stripe restricted key.");
  const k = key.trim();
  if (!isRestrictedKey(k)) {
    return fail(400, "That isn't a restricted key. It should start with rk_live_ (or rk_test_ for test mode). Secret keys (sk_) aren't accepted because they can change your account.");
  }

  const db = await serverSupabase();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return fail(401, "Your session has ended. Sign in again.");

  let accountName: string | null;
  try {
    accountName = await checkKey(k);
  } catch (e) {
    if (e instanceof StripeError && e.status === 403) {
      return fail(400, "Stripe says this key can't read charges. Edit the key in Stripe and set Charges to Read.");
    }
    return fail(400, e instanceof StripeError && e.status === 401 ? "Stripe didn't recognise that key. Check you copied all of it." : "Couldn't reach Stripe. Try again.");
  }

  let secret: string;
  try {
    secret = encryptSecret(k);
  } catch (e) {
    return fail(500, (e as Error).message);
  }
  const saved = await db
    .from("connections")
    .upsert({ business_id: businessId, provider: "stripe", account_name: accountName, secret, synced_until: 0, last_error: null }, { onConflict: "business_id,provider" });
  if (saved.error) return fail(400, saved.error.message);

  try {
    return NextResponse.json({ accountName, ...(await syncStripe(db, businessId)) });
  } catch (e) {
    return NextResponse.json({ accountName, syncError: (e as Error).message });
  }
}

/** Disconnect. Sales already synced stay, and can be removed from the file list. */
export async function DELETE(request: NextRequest) {
  const businessId = request.nextUrl.searchParams.get("businessId");
  if (!businessId) return fail(400, "Missing business.");
  const db = await serverSupabase();
  const res = await db.from("connections").delete().eq("business_id", businessId).eq("provider", "stripe");
  if (res.error) return fail(400, res.error.message);
  return NextResponse.json({ ok: true });
}
