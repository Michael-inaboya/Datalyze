import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { cleanSales, dateOrder, detectPreset, parseAmount, parseDate, readTable } from "../importers";

const SAMPLES = join(__dirname, "../../../../samples");
function load(file: string) {
  const data = Papa.parse<string[]>(readFileSync(join(SAMPLES, file), "utf8"), { skipEmptyLines: true }).data;
  const { headers, raw } = readTable(data);
  const preset = detectPreset(headers);
  return { headers, raw, preset };
}

describe("parseAmount", () => {
  it("reads currency symbols, thousands separators and negatives", () => {
    expect(parseAmount("$1,234.50")).toBe(1234.5);
    expect(parseAmount("£12")).toBe(12);
    expect(parseAmount("(45.00)")).toBe(-45);
    expect(parseAmount("-3.5")).toBe(-3.5);
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("")).toBeNaN();
  });
});

describe("dates", () => {
  it("reads ISO dates regardless of order", () => {
    expect(parseDate("2026-03-04 10:15:00 -0500", "MDY")).toBe(Date.UTC(2026, 2, 4));
  });
  it("detects day-first and month-first from the data", () => {
    expect(dateOrder(["03/04/2026", "25/04/2026"], "MDY")).toBe("DMY");
    expect(dateOrder(["03/04/2026", "04/25/2026"], "DMY")).toBe("MDY");
  });
  it("uses the fallback when every date is ambiguous", () => {
    expect(dateOrder(["03/04/2026"], "MDY")).toBe("MDY");
    expect(parseDate("03/04/2026", "MDY")).toBe(Date.UTC(2026, 2, 4));
    expect(parseDate("03/04/2026", "DMY")).toBe(Date.UTC(2026, 3, 3));
  });
});

describe("presets", () => {
  it("reads a Shopify orders export, carrying order fields to later line items and skipping refunds", () => {
    const { headers, raw, preset } = load("shopify_orders.csv");
    expect(preset?.name).toBe("Shopify orders export");
    const { rows, skipped } = cleanSales(preset!.parse(headers, raw), "MDY");
    expect(skipped).toBe(0);
    expect(rows.length).toBeGreaterThan(900);
    expect(rows.every((r) => r.customer && r.product && r.order)).toBe(true);
  });

  it("reads a Stripe payments export and drops failed charges", () => {
    const { headers, raw, preset } = load("stripe_payments.csv");
    expect(preset?.name).toBe("Stripe payments export");
    const failed = raw.filter((r) => r[headers.indexOf("Status")] === "Failed").length;
    const { rows } = cleanSales(preset!.parse(headers, raw), "MDY");
    expect(failed).toBeGreaterThan(0);
    expect(rows.length).toBe(raw.length - failed);
  });

  it("reads a Square export with US dates and keeps walk-in sales without a customer", () => {
    const { headers, raw, preset } = load("square_items.csv");
    expect(preset?.name).toBe("Square sales export");
    const { rows, skipped } = cleanSales(preset!.parse(headers, raw), "DMY");
    expect(skipped).toBe(0);
    expect(rows.some((r) => r.customer === "")).toBe(true);
    expect(Math.max(...rows.map((r) => r.date))).toBeLessThanOrEqual(Date.UTC(2026, 11, 31));
  });

  it("reads a QuickBooks report with a title block, customer group rows and totals", () => {
    const { headers, raw, preset } = load("qbo_sales_by_customer.csv");
    expect(preset?.name).toBe("QuickBooks sales report");
    const { rows, skipped } = cleanSales(preset!.parse(headers, raw), "MDY");
    expect(rows.length).toBe(160);
    expect(skipped).toBe(0);
    expect(new Set(rows.map((r) => r.customer))).toEqual(new Set(["Acme Ltd", "Brightside LLC", "Corner Cafe", "Delta Gym"]));
  });
});
