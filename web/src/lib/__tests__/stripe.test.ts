import { describe, expect, it } from "vitest";
import { chargesToSales, isRestrictedKey, type StripeCharge } from "../stripe";

const charge = (over: Partial<StripeCharge>): StripeCharge => ({
  id: "ch_1", amount: 2500, amount_refunded: 0, currency: "gbp", created: Date.UTC(2026, 9, 3, 23, 30) / 1000,
  status: "succeeded", paid: true, customer: "cus_9", receipt_email: null, billing_details: { email: "amy@example.com", name: "Amy" }, ...over,
});

describe("chargesToSales", () => {
  it("turns a paid charge into a sale on its UTC day", () => {
    const { rows } = chargesToSales([charge({})], "GBP");
    expect(rows).toEqual([{ date: Date.UTC(2026, 9, 3), customer: "amy@example.com", amount: 25, product: null, quantity: 1, order: "ch_1" }]);
  });

  it("nets off partial refunds and drops failed or fully refunded charges", () => {
    const { rows } = chargesToSales(
      [
        charge({ id: "a", amount_refunded: 500 }),
        charge({ id: "b", status: "failed", paid: false }),
        charge({ id: "c", amount_refunded: 2500 }),
      ],
      "GBP",
    );
    expect(rows.map((r) => [r.order, r.amount])).toEqual([["a", 20]]);
  });

  it("leaves out other currencies and counts them", () => {
    const res = chargesToSales([charge({ currency: "usd" }), charge({ id: "ch_2" })], "GBP");
    expect(res.rows.map((r) => r.order)).toEqual(["ch_2"]);
    expect(res.otherCurrency).toBe(1);
  });

  it("falls back from billing email to receipt email, name, then customer id", () => {
    const names = [
      charge({ billing_details: null, receipt_email: "r@example.com" }),
      charge({ billing_details: { email: null, name: "Bo" } }),
      charge({ billing_details: null }),
    ].map((c) => chargesToSales([c], "GBP").rows[0].customer);
    expect(names).toEqual(["r@example.com", "Bo", "cus_9"]);
  });
});

describe("isRestrictedKey", () => {
  it("accepts restricted keys only", () => {
    expect(isRestrictedKey("rk_live_51Habcdefghijklmnop")).toBe(true);
    expect(isRestrictedKey(" rk_test_51Habcdefghijklmnop ")).toBe(true);
    expect(isRestrictedKey("sk_live_51Habcdefghijklmnop")).toBe(false);
    expect(isRestrictedKey("pk_live_51Habcdefghijklmnop")).toBe(false);
  });
});
