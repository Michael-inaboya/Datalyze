import { analyze, DAY } from "./analytics";
import { isoDay } from "./format";
import type { Currency, Expense, Sale } from "./types";

/* What the AI analyst sees: a compact summary up front, plus a breakdown tool for anything finer. */

const r2 = (v: number) => Math.round(v * 100) / 100;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The same numbers the dashboard shows, as JSON the model can quote from. */
export function summarize(name: string, currency: Currency, sales: Sale[], expenses: Expense[]): string {
  if (!sales.length) return JSON.stringify({ business: name, currency, note: "No sales imported yet." });
  const R = analyze(sales, expenses);
  const products = R.products?.slice(0, 15).map((p) => ({ product: p.name, last90: r2(p.v), prev90: r2(p.prev) })) ?? null;
  const byRisk = [...R.atRisk].sort((a, b) => b.yearly * b.risk - a.yearly * a.risk);
  const customer = (c: (typeof R.custs)[number]) => ({
    name: c.name, total: r2(c.total), orders: c.orders, first: isoDay(c.first), last: isoDay(c.last),
    daysSinceLast: Math.round(c.recency), usualGapDays: Math.round(c.expected), churnRisk: r2(c.risk), tier: c.tier,
    spendTrend: r2(c.trend), yearlyValue: r2(c.yearly), suggestedAction: c.action,
  });
  return JSON.stringify({
    business: name,
    currency,
    dataFrom: isoDay(R.minD),
    dataTo: isoDay(R.asOf),
    salesRows: sales.length,
    expenseRows: expenses.length,
    kpis: {
      revenueLast30: r2(R.rev30), revenuePrev30: r2(R.revPrev30),
      revenueLast90: r2(R.rev90), revenuePrev90: r2(R.revPrev90),
      avgOrderLast90: r2(R.aov90), avgOrderPrev90: r2(R.aovPrev90),
      expensesLast90: R.hasExp ? r2(R.exp90) : null,
      activeCustomers90d: R.active, activeCustomersPrev90d: R.activePrev,
      namedCustomers: R.custs.length,
      repeatRate: R.repeatRate == null ? null : r2(R.repeatRate),
      top10PctCustomersShareOfRevenue: r2(R.top10Share),
      walkInShareOfRevenue: r2(R.anonShare),
      yearlyRevenueAtRisk: r2(R.revAtRisk),
    },
    forecast: R.forecast && {
      method: "Damped-trend Holt on weekly revenue, 80% interval",
      next4Weeks: r2(R.forecast.next4), last4Weeks: r2(R.forecast.last4), next12Weeks: r2(R.forecast.next12),
      weekly: R.forecast.dates.map((d, i) => ({
        weekEnding: isoDay(d), expected: r2(R.forecast!.values[i]), low: r2(R.forecast!.lo[i]), high: r2(R.forecast!.hi[i]),
      })),
      backtest8Weeks: R.forecast.backtest && {
        predicted: r2(R.forecast.backtest.predicted), actual: r2(R.forecast.backtest.actual), errorPct: r2(R.forecast.backtest.err),
      },
    },
    months: R.monthKeys.slice(-24).map((k) => {
      const m = R.months[k];
      const cats = Object.entries(m.cats).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, v]) => ({ category: c, amount: r2(v) }));
      return { month: k, revenue: r2(m.rev), expenses: r2(m.exp), topExpenseCategories: cats };
    }),
    revenueByWeekdayLast90: Object.fromEntries(WEEKDAYS.map((d, i) => [d, r2(R.weekday[i])])),
    topProductsLast90: products,
    topCustomers: [...R.custs].sort((a, b) => b.total - a.total).slice(0, 15).map(customer),
    atRiskCustomers: byRisk.slice(0, 15).map(customer),
    atRiskCount: R.atRisk.length,
  });
}

export type BreakdownInput = {
  metric: "revenue" | "orders" | "units" | "expenses";
  group_by: "none" | "day" | "week" | "month" | "weekday" | "customer" | "product" | "category";
  from?: string;
  to?: string;
  customer?: string;
  product?: string;
  category?: string;
  limit?: number;
};

export const BREAKDOWN_SCHEMA = {
  type: "object",
  properties: {
    metric: { type: "string", enum: ["revenue", "orders", "units", "expenses"], description: "What to add up. 'expenses' reads the costs data; the rest read sales." },
    group_by: {
      type: "string",
      enum: ["none", "day", "week", "month", "weekday", "customer", "product", "category"],
      description: "How to split the total. 'category' only applies to expenses; 'customer' and 'product' only to sales. Weeks start on Monday.",
    },
    from: { type: "string", description: "First day included, YYYY-MM-DD." },
    to: { type: "string", description: "Last day included, YYYY-MM-DD." },
    customer: { type: "string", description: "Only sales whose customer name contains this text (case-insensitive)." },
    product: { type: "string", description: "Only sales whose product contains this text (case-insensitive)." },
    category: { type: "string", description: "Only expenses whose category contains this text (case-insensitive)." },
    limit: { type: "integer", description: "Most groups to return, largest first for customer/product/category, latest first for dates. Default 50, max 200." },
  },
  required: ["metric", "group_by"],
  additionalProperties: false,
} as const;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const has = (value: string | null, needle?: string) => !needle || (value ?? "").toLowerCase().includes(needle.toLowerCase());

/** Sums sales or expenses over a filter and grouping. Throws on input the model should correct. */
export function breakdown(sales: Sale[], expenses: Expense[], input: BreakdownInput) {
  const { metric, group_by } = input;
  if (!["revenue", "orders", "units", "expenses"].includes(metric)) throw new Error(`Unknown metric "${metric}".`);
  for (const k of ["from", "to"] as const) if (input[k] && !ISO.test(input[k]!)) throw new Error(`"${k}" must be YYYY-MM-DD.`);
  const from = input.from ? Date.parse(input.from + "T00:00:00Z") : -Infinity;
  const to = input.to ? Date.parse(input.to + "T00:00:00Z") : Infinity;
  const isExp = metric === "expenses";
  if (isExp && (group_by === "customer" || group_by === "product")) throw new Error("Expenses have no customer or product; group by category or a date instead.");
  if (!isExp && group_by === "category") throw new Error("Only expenses have categories.");
  const limit = Math.min(200, Math.max(1, Math.floor(input.limit ?? 50)));

  type Row = { date: number; customer: string; product: string | null; category: string; amount: number; quantity: number; order: string };
  const rows: Row[] = isExp
    ? expenses.filter((e) => has(e.category, input.category)).map((e) => ({ date: e.date, customer: "", product: null, category: e.category, amount: e.amount, quantity: 0, order: "" }))
    : sales
        .filter((s) => has(s.customer, input.customer) && has(s.product, input.product))
        .map((s, i) => ({ date: s.date, customer: s.customer, product: s.product, category: "", amount: s.amount, quantity: s.quantity, order: s.order || (s.customer ? s.customer + "|" + s.date : "walk-in" + i) }));

  const keyOf = (r: Row): string => {
    switch (group_by) {
      case "day": return isoDay(r.date);
      case "week": return isoDay(r.date - ((new Date(r.date).getUTCDay() + 6) % 7) * DAY);
      case "month": return isoDay(r.date).slice(0, 7);
      case "weekday": return WEEKDAYS[new Date(r.date).getUTCDay()];
      case "customer": return r.customer || "(walk-in / guest)";
      case "product": return r.product || "(no product)";
      case "category": return r.category;
      default: return "total";
    }
  };
  const groups = new Map<string, { amount: number; units: number; orders: Set<string> }>();
  let matched = 0;
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    matched++;
    const k = keyOf(r);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { amount: 0, units: 0, orders: new Set() }));
    g.amount += r.amount;
    g.units += r.quantity;
    g.orders.add(r.order);
  }
  const value = (g: { amount: number; units: number; orders: Set<string> }) =>
    metric === "orders" ? g.orders.size : metric === "units" ? g.units : r2(g.amount);
  let out = [...groups.entries()].map(([group, g]) => ({ group, value: value(g) }));
  const byDate = ["day", "week", "month"].includes(group_by);
  if (byDate) out.sort((a, b) => b.group.localeCompare(a.group));
  else if (group_by === "weekday") out.sort((a, b) => WEEKDAYS.indexOf(a.group) - WEEKDAYS.indexOf(b.group));
  else out.sort((a, b) => b.value - a.value);
  const totalGroups = out.length;
  out = out.slice(0, limit);
  if (byDate) out.reverse();
  return { metric, group_by, rowsMatched: matched, totalGroups, truncated: totalGroups > out.length, groups: out };
}
