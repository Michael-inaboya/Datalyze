import { describe, expect, it } from "vitest";
import { validTurns } from "../analyst";
import { breakdown, summarize } from "../analystData";
import { sampleBusiness } from "../sample";
import type { Expense, Sale } from "../types";

const day = (s: string) => Date.parse(s + "T00:00:00Z");
const sale = (date: string, customer: string, amount: number, product: string | null = null, order: string | null = null): Sale => ({
  date: day(date), customer, amount, product, quantity: 1, order,
});
const sales: Sale[] = [
  sale("2026-01-05", "Amy Lee", 20, "Beans", "o1"),
  sale("2026-01-05", "Amy Lee", 5, "Mug", "o1"),
  sale("2026-01-20", "Ben Roe", 40, "Beans", "o2"),
  sale("2026-02-02", "", 10, "Beans"),
  sale("2026-02-03", "amy lee", 15, "Mug", "o3"),
];
const expenses: Expense[] = [
  { date: day("2026-01-10"), category: "Rent", amount: 500 },
  { date: day("2026-02-10"), category: "Rent", amount: 500 },
  { date: day("2026-02-12"), category: "Packaging", amount: 60 },
];

describe("breakdown", () => {
  it("sums revenue by month in date order", () => {
    const out = breakdown(sales, expenses, { metric: "revenue", group_by: "month" });
    expect(out.groups).toEqual([{ group: "2026-01", value: 65 }, { group: "2026-02", value: 25 }]);
    expect(out.rowsMatched).toBe(5);
  });

  it("counts an order with several lines once", () => {
    const out = breakdown(sales, expenses, { metric: "orders", group_by: "none", to: "2026-01-31" });
    expect(out.groups).toEqual([{ group: "total", value: 2 }]);
  });

  it("filters by customer without caring about case, largest first", () => {
    const out = breakdown(sales, expenses, { metric: "revenue", group_by: "customer", customer: "e" });
    expect(out.groups).toEqual([{ group: "Amy Lee", value: 25 }, { group: "Ben Roe", value: 40 }, { group: "amy lee", value: 15 }].sort((a, b) => b.value - a.value));
    const amy = breakdown(sales, expenses, { metric: "revenue", group_by: "none", customer: "AMY" });
    expect(amy.groups).toEqual([{ group: "total", value: 40 }]);
  });

  it("labels walk-in sales and keeps the latest periods when limited", () => {
    expect(breakdown(sales, expenses, { metric: "revenue", group_by: "customer" }).groups.map((g) => g.group)).toContain("(walk-in / guest)");
    const out = breakdown(sales, expenses, { metric: "revenue", group_by: "day", limit: 2 });
    expect(out.groups.map((g) => g.group)).toEqual(["2026-02-02", "2026-02-03"]);
    expect(out.truncated).toBe(true);
  });

  it("groups weeks from Monday", () => {
    // 2026-02-02 is a Monday and 2026-02-03 the Tuesday after
    const out = breakdown(sales, expenses, { metric: "revenue", group_by: "week", from: "2026-02-01" });
    expect(out.groups).toEqual([{ group: "2026-02-02", value: 25 }]);
  });

  it("reads costs by category", () => {
    const out = breakdown(sales, expenses, { metric: "expenses", group_by: "category", from: "2026-02-01" });
    expect(out.groups).toEqual([{ group: "Rent", value: 500 }, { group: "Packaging", value: 60 }]);
  });

  it("rejects input the model should correct", () => {
    expect(() => breakdown(sales, expenses, { metric: "expenses", group_by: "customer" })).toThrow(/category/);
    expect(() => breakdown(sales, expenses, { metric: "revenue", group_by: "category" })).toThrow(/expenses/);
    expect(() => breakdown(sales, expenses, { metric: "revenue", group_by: "none", from: "1/2/2026" })).toThrow(/YYYY-MM-DD/);
  });
});

describe("summarize", () => {
  it("carries the dashboard figures for the sample business", () => {
    const { sales, expenses } = sampleBusiness();
    const s = JSON.parse(summarize("Ember", "USD", sales, expenses));
    expect(s.dataTo).toMatch(/^2026-09-/);
    expect(s.kpis.revenueLast30).toBeGreaterThan(0);
    expect(s.forecast.weekly).toHaveLength(12);
    expect(s.atRiskCustomers.length).toBeGreaterThan(0);
    expect(s.topCustomers).toHaveLength(15);
  });

  it("stays small enough to send with every question", () => {
    const { sales, expenses } = sampleBusiness();
    expect(summarize("Ember", "USD", sales, expenses).length).toBeLessThan(40_000);
  });

  it("says when there are no sales", () => {
    expect(JSON.parse(summarize("New", "GBP", [], [])).note).toMatch(/No sales/);
  });
});

describe("validTurns", () => {
  it("accepts alternating turns ending on a question", () => {
    expect(validTurns([{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }, { role: "user", content: "Sales?" }])).toHaveLength(3);
  });

  it("rejects anything else", () => {
    expect(validTurns([])).toBeNull();
    expect(validTurns("Sales?")).toBeNull();
    expect(validTurns([{ role: "assistant", content: "Hello" }])).toBeNull();
    expect(validTurns([{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }])).toBeNull();
    expect(validTurns([{ role: "user", content: " " }])).toBeNull();
    expect(validTurns([{ role: "user", content: "x".repeat(1001) }])).toBeNull();
  });
});
