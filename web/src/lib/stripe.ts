import type { Sale } from "./types";

/** The parts of a Stripe Charge object that Datalyze reads. */
export type StripeCharge = {
  id: string;
  amount: number;
  amount_refunded: number;
  currency: string;
  created: number;
  status: string;
  paid: boolean;
  customer: string | null;
  receipt_email: string | null;
  billing_details?: { email: string | null; name: string | null } | null;
};

/** Restricted keys can only read what they are granted, so they are the only kind accepted. */
export const isRestrictedKey = (k: string) => /^rk_(live|test)_[A-Za-z0-9]{10,}$/.test(k.trim());

/**
 * Turns successful charges into sales. Charges in a currency other than the business's are left out,
 * because amounts can't be added up across currencies.
 */
export function chargesToSales(charges: StripeCharge[], currency: string): { rows: Sale[]; otherCurrency: number } {
  const rows: Sale[] = [];
  let otherCurrency = 0;
  for (const c of charges) {
    if (c.status !== "succeeded" || !c.paid) continue;
    const net = c.amount - (c.amount_refunded || 0);
    if (net <= 0) continue;
    if (c.currency.toLowerCase() !== currency.toLowerCase()) {
      otherCurrency++;
      continue;
    }
    const d = new Date(c.created * 1000);
    rows.push({
      date: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
      customer: c.billing_details?.email || c.receipt_email || c.billing_details?.name || c.customer || "",
      // Datalyze's currencies (USD, GBP, EUR, CAD, AUD) all use two decimal places in Stripe.
      amount: net / 100,
      product: null,
      quantity: 1,
      order: c.id,
    });
  }
  return { rows, otherCurrency };
}
