import { describe, expect, it } from "vitest";
import { analyze, buildInsights, DAY, fitHolt, project } from "../analytics";
import { moneyFormatter } from "../format";
import { sampleBusiness } from "../sample";
import type { Sale } from "../types";

const sale = (day: number, customer: string, amount = 50): Sale => ({
  date: Date.UTC(2026, 0, 1) + day * DAY, customer, amount, product: "Beans", quantity: 1, order: null,
});

describe("forecast", () => {
  it("follows a steady upward trend", () => {
    const y = Array.from({ length: 40 }, (_, i) => 1000 + i * 20);
    const f = project(fitHolt(y), 4);
    expect(f[0]).toBeGreaterThan(y[y.length - 1]);
    expect(f[0]).toBeLessThan(y[y.length - 1] + 60);
  });
  it("never forecasts negative sales", () => {
    const y = Array.from({ length: 30 }, (_, i) => Math.max(0, 500 - i * 30));
    expect(Math.min(...project(fitHolt(y), 12))).toBeGreaterThanOrEqual(0);
  });
});

describe("churn risk", () => {
  it("flags a regular customer who has stopped buying and not one who is on schedule", () => {
    const sales: Sale[] = [];
    for (let d = 0; d <= 180; d += 10) sales.push(sale(d, "Steady"));
    for (let d = 0; d <= 100; d += 10) sales.push(sale(d, "Gone quiet"));
    const R = analyze(sales, []);
    const by = Object.fromEntries(R.custs.map((c) => [c.name, c]));
    expect(by["Steady"].tier).toBe("Low");
    expect(["High", "Lapsed"]).toContain(by["Gone quiet"].tier);
  });
  it("leaves walk-in sales out of customer counts but keeps them in revenue", () => {
    const R = analyze([sale(0, "Ann"), sale(1, ""), sale(2, "")], []);
    expect(R.custs.map((c) => c.name)).toEqual(["Ann"]);
    expect(R.rev30).toBe(150);
    expect(R.anonShare).toBeCloseTo(2 / 3);
  });
});

describe("sample business", () => {
  it("produces a forecast with a tested accuracy and a full set of insights", () => {
    const { sales, expenses } = sampleBusiness();
    const R = analyze(sales, expenses);
    expect(R.forecast?.backtest).not.toBeNull();
    expect(R.forecast!.backtest!.err).toBeLessThan(0.25);
    const insights = buildInsights(R, moneyFormatter("USD"));
    expect(insights.length).toBeGreaterThan(5);
    expect(insights[0].tone).toBe("bad");
    expect(insights.every((i) => !/NaN|undefined|Infinity/.test(i.title + i.detail))).toBe(true);
  });
});
