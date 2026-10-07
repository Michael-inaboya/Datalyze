import type { Expense, Sale } from "./types";
import { pa, pct, type Money } from "./format";

export const DAY = 86400000;

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
export const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* ---------- forecasting: damped-trend Holt, grid-searched ---------- */

export type HoltModel = { l: number; t: number; sse: number; a: number; b: number; phi: number };

function holt(y: number[], a: number, b: number, phi: number): HoltModel {
  let l = y[0];
  let t = y.length >= 8 ? (sum(y.slice(4, 8)) - sum(y.slice(0, 4))) / 16 : y[1] - y[0];
  let sse = 0;
  for (let i = 1; i < y.length; i++) {
    const f = l + phi * t;
    sse += (y[i] - f) ** 2;
    const nl = a * y[i] + (1 - a) * (l + phi * t);
    t = b * (nl - l) + (1 - b) * phi * t;
    l = nl;
  }
  return { l, t, sse, a, b, phi };
}

export function fitHolt(y: number[]): HoltModel {
  let best: HoltModel | null = null;
  for (let a = 0.05; a <= 0.81; a += 0.05)
    for (const b of [0.01, 0.03, 0.06, 0.1, 0.2])
      for (const phi of [0.9, 0.95, 0.98]) {
        const m = holt(y, a, b, phi);
        if (!best || m.sse < best.sse) best = m;
      }
  return best!;
}

export function project(m: HoltModel, h: number): number[] {
  const out: number[] = [];
  let damp = 0;
  for (let i = 1; i <= h; i++) {
    damp += m.phi ** i;
    out.push(Math.max(0, m.l + damp * m.t));
  }
  return out;
}

export type Forecast = {
  values: number[];
  lo: number[];
  hi: number[];
  dates: number[];
  next4: number;
  last4: number;
  next12: number;
  backtest: { predicted: number; actual: number; err: number } | null;
};

export type Tier = "High" | "Medium" | "Low" | "Lapsed";

export type CustomerStats = {
  name: string;
  total: number;
  orders: number;
  first: number;
  last: number;
  expected: number;
  recency: number;
  trend: number;
  risk: number;
  yearly: number;
  tier: Tier;
  action: string;
};

export type MonthStats = { rev: number; exp: number; cats: Record<string, number> };

export type Analysis = ReturnType<typeof analyze>;

export function analyze(sales: Sale[], expenses: Expense[]) {
  let asOf = -Infinity, minD = Infinity;
  for (const s of sales) {
    if (s.date > asOf) asOf = s.date;
    if (s.date < minD) minD = s.date;
  }
  const win = (from: number, to: number) => sales.filter((s) => s.date > asOf - from * DAY && s.date <= asOf - to * DAY);
  const rev = (rows: Sale[]) => sum(rows.map((s) => s.amount));
  const last30 = win(30, 0), prev30 = win(60, 30), last90 = win(90, 0), prev90 = win(180, 90);
  const orderCount = (rows: Sale[]) =>
    new Set(rows.map((s, i) => s.order || (s.customer ? s.customer + "|" + s.date : "walk-in" + i))).size;

  // weekly series, weeks ending on the latest sale date so the last week is complete
  const nWeeks = Math.floor((asOf - minD) / DAY / 7) + 1;
  const weeks: number[] = new Array(nWeeks).fill(0);
  for (const s of sales) {
    const idx = nWeeks - 1 - Math.floor((asOf - s.date) / DAY / 7);
    if (idx >= 0) weeks[idx] += s.amount;
  }
  if (nWeeks > 1 && (asOf - minD) / DAY / 7 < nWeeks - 0.5) weeks.shift(); // drop partial first week
  const weekEnds = weeks.map((_, i) => asOf - (weeks.length - 1 - i) * 7 * DAY);

  let forecast: Forecast | null = null;
  if (weeks.length >= 10) {
    const m = fitHolt(weeks), H = 12, f = project(m, H);
    const sd = Math.sqrt(m.sse / Math.max(1, weeks.length - 1));
    const lo = f.map((v, i) => Math.max(0, v - 1.28 * sd * Math.sqrt(i + 1)));
    const hi = f.map((v, i) => v + 1.28 * sd * Math.sqrt(i + 1));
    let backtest: Forecast["backtest"] = null;
    if (weeks.length >= 26) {
      const bt = project(fitHolt(weeks.slice(0, -8)), 8), act = sum(weeks.slice(-8));
      backtest = { predicted: sum(bt), actual: act, err: Math.abs(sum(bt) - act) / act };
    }
    forecast = {
      values: f, lo, hi,
      dates: f.map((_, i) => asOf + (i + 1) * 7 * DAY),
      next4: sum(f.slice(0, 4)), last4: sum(weeks.slice(-4)), next12: sum(f), backtest,
    };
  }

  // customers
  const custMap = new Map<string, { name: string; total: number; days: Map<number, number> }>();
  for (const s of sales) {
    if (!s.customer) continue; // walk-in or guest sales count toward revenue, not customer behaviour
    let c = custMap.get(s.customer);
    if (!c) custMap.set(s.customer, (c = { name: s.customer, total: 0, days: new Map() }));
    c.total += s.amount;
    c.days.set(s.date, (c.days.get(s.date) || 0) + s.amount);
  }
  const allGaps: number[] = [];
  const base = [...custMap.values()].map((c) => {
    const days = [...c.days.keys()].sort((a, b) => a - b);
    const amounts = days.map((d) => c.days.get(d)!);
    const gaps = days.slice(1).map((d, i) => (d - days[i]) / DAY);
    allGaps.push(...gaps);
    return { name: c.name, total: c.total, days, amounts, gaps };
  });
  const globalGap = Math.max(7, median(allGaps) || 30);
  const custs: CustomerStats[] = base.map((c) => {
    const orders = c.days.length;
    const first = c.days[0], last = c.days[orders - 1];
    const expected =
      orders >= 3 ? Math.max(7, median(c.gaps)) : orders === 2 ? Math.max(7, (c.gaps[0] + globalGap) / 2) : globalGap * 1.5;
    const recency = (asOf - last) / DAY;
    const ratio = recency / expected;
    const h = Math.floor(orders / 2);
    const trend = orders >= 4 ? sum(c.amounts.slice(-h)) / h / (sum(c.amounts.slice(0, h)) / h) : 1;
    let risk = 1 / (1 + Math.exp(-2.2 * (ratio - 1.8)));
    if (trend < 0.75) risk = Math.min(0.99, risk + 0.15);
    const yearly = (c.total * 365) / Math.max(90, (asOf - first) / DAY);
    const tier: Tier = ratio > 5 && recency > 120 ? "Lapsed" : risk >= 0.65 ? "High" : risk >= 0.35 ? "Medium" : "Low";
    const action =
      tier === "Lapsed" ? "Win-back offer, or remove from active list"
      : tier === "Low" ? "No action needed"
      : yearly > 1500 ? "Call personally this week"
      : orders === 1 ? "Send a second-purchase discount"
      : trend < 0.75 ? "Ask for feedback: spending is dropping"
      : 'Send a "we miss you" offer';
    return { name: c.name, total: c.total, orders, first, last, expected, recency, trend, risk, yearly, tier, action };
  });
  const atRisk = custs.filter((c) => c.tier === "High" || c.tier === "Medium");

  // products
  let products: { name: string; v: number; prev: number }[] | null = null;
  if (sales.some((s) => s.product)) {
    const agg = (rows: Sale[]) => {
      const m = new Map<string, number>();
      rows.forEach((s) => m.set(s.product || "Other", (m.get(s.product || "Other") || 0) + s.amount));
      return m;
    };
    const now = agg(last90), before = agg(prev90);
    products = [...now.entries()].map(([name, v]) => ({ name, v, prev: before.get(name) || 0 })).sort((a, b) => b.v - a.v);
  }

  // months; a month counts once it is complete
  const mkey = (d: number) => new Date(d).toISOString().slice(0, 7);
  const months: Record<string, MonthStats> = {};
  for (const s of sales) (months[mkey(s.date)] ||= { rev: 0, exp: 0, cats: {} }).rev += s.amount;
  for (const e of expenses) {
    const m = (months[mkey(e.date)] ||= { rev: 0, exp: 0, cats: {} });
    m.exp += e.amount;
    m.cats[e.category] = (m.cats[e.category] || 0) + e.amount;
  }
  const asOfMonthComplete = mkey(asOf + DAY) !== mkey(asOf);
  const monthKeys = Object.keys(months).sort().filter((k) => k < mkey(asOf) || (asOfMonthComplete && k === mkey(asOf)));

  const exp90 = sum(expenses.filter((e) => e.date > asOf - 90 * DAY && e.date <= asOf).map((e) => e.amount));
  const named = sum(custs.map((c) => c.total));
  const totalRev = sum(sales.map((s) => s.amount));
  const sorted = [...custs].sort((a, b) => b.total - a.total);
  const top10 = sorted.slice(0, Math.max(1, Math.round(custs.length * 0.1)));
  const weekday: number[] = new Array(7).fill(0);
  last90.forEach((s) => (weekday[new Date(s.date).getUTCDay()] += s.amount));

  return {
    asOf, minD, weeks, weekEnds, forecast, custs, atRisk, products, months, monthKeys,
    active: custs.filter((c) => c.recency <= 90).length,
    activePrev: base.filter((c) => c.days.some((d) => d <= asOf - 90 * DAY && d > asOf - 180 * DAY)).length,
    revAtRisk: sum(atRisk.map((c) => c.yearly * c.risk)),
    rev30: rev(last30), revPrev30: rev(prev30), rev90: rev(last90), revPrev90: rev(prev90),
    aov90: rev(last90) / Math.max(1, orderCount(last90)),
    aovPrev90: rev(prev90) / Math.max(1, orderCount(prev90)),
    exp90, hasExp: expenses.length > 0,
    top10Share: named ? sum(top10.map((c) => c.total)) / named : 0,
    top10n: top10.length,
    anonShare: totalRev ? 1 - named / totalRev : 0,
    repeatRate: custs.length ? custs.filter((c) => c.orders > 1).length / custs.length : null,
    weekday,
  };
}

export type Tone = "bad" | "warn" | "good" | "info";
export type Insight = { tone: Tone; title: string; detail: string };

export function buildInsights(R: Analysis, money: Money): Insight[] {
  const out: Insight[] = [];
  const add = (tone: Tone, title: string, detail: string) => out.push({ tone, title, detail });
  const ch30 = R.revPrev30 ? R.rev30 / R.revPrev30 - 1 : 0;
  if (R.revPrev30)
    add(ch30 >= 0.03 ? "good" : ch30 <= -0.05 ? "bad" : "info",
      `Sales ${ch30 >= 0 ? "up" : "down"} ${pa(ch30)} in the last 30 days`,
      `${money(R.rev30)} vs ${money(R.revPrev30)} in the 30 days before.`);
  if (R.forecast) {
    const f = R.forecast, c = f.next4 / f.last4 - 1;
    add(c >= 0.02 ? "good" : c <= -0.05 ? "warn" : "info", `Next 4 weeks forecast: ${money(f.next4, true)}`,
      `${Math.abs(c) < 0.01 ? "In line with" : "About " + pa(c) + (c > 0 ? " above" : " below")} the last 4 weeks. Plan stock and staffing to match.`);
  }
  if (R.atRisk.length) {
    const top = [...R.atRisk].sort((a, b) => b.yearly * b.risk - a.yearly * a.risk).slice(0, 3).map((c) => c.name);
    add("bad", `${R.atRisk.length} customers are at risk of leaving`,
      `They are worth about ${money(R.revAtRisk, true)} a year in expected sales. Start with ${top.join(", ")}.`);
  }
  if (R.products && R.products.length > 1) {
    const total = sum(R.products.map((p) => p.v)), p0 = R.products[0];
    add("info", `${p0.name} brings in ${pa(p0.v / total)} of revenue`, `Your best seller over the last 90 days, at ${money(p0.v)}.`);
    const growers = R.products.filter((p) => p.prev > total * 0.02).map((p) => ({ ...p, g: p.v / p.prev - 1 })).sort((a, b) => b.g - a.g);
    if (growers.length && growers[0].g > 0.1)
      add("good", `${growers[0].name} is your fastest-growing product`, `Up ${pa(growers[0].g)} compared with the previous 90 days.`);
    const fallers = growers.filter((p) => p.g < -0.15);
    if (fallers.length) {
      const f = fallers[fallers.length - 1];
      add("warn", `${f.name} sales fell ${pa(f.g)}`, "Compared with the previous 90 days. Check pricing, stock-outs or competition.");
    }
  }
  if (R.top10Share > 0.35)
    add("warn", `Your top ${R.top10n} customers bring in ${pa(R.top10Share)} of sales`, "Losing even one of them would hurt. Keep them close with regular check-ins.");
  if (R.repeatRate != null)
    add(R.repeatRate >= 0.5 ? "good" : "warn", `${pa(R.repeatRate)} of customers have bought more than once`,
      R.repeatRate >= 0.5 ? "Good loyalty. A referral reward could turn regulars into new customers."
        : "Most buyers do not come back. A follow-up message after the first order usually helps.");
  if (R.aovPrev90) {
    const c = R.aov90 / R.aovPrev90 - 1;
    if (Math.abs(c) > 0.05)
      add(c > 0 ? "good" : "warn", `Average order value ${c > 0 ? "rose" : "fell"} ${pa(c)}`,
        `${money(R.aov90)} per order over the last 90 days, vs ${money(R.aovPrev90)} before.`);
  }
  if (R.anonShare > 0.2)
    add("info", `${pa(R.anonShare)} of sales have no customer attached`,
      "These walk-in or guest sales count toward revenue and forecasts, but not customer risk. Capturing an email at checkout makes churn tracking more complete.");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const wd = R.weekday, best = wd.indexOf(Math.max(...wd)), worst = wd.indexOf(Math.min(...wd));
  if (sum(wd) > 0 && wd[worst] > 0)
    add("info", `${days[best]} is your busiest day`,
      `It brings ${(wd[best] / wd[worst]).toFixed(1)}× the sales of ${days[worst]}, your quietest day. Promotions work best on quiet days.`);
  if (R.hasExp && R.monthKeys.length >= 2) {
    const k = R.monthKeys.slice(-3);
    const rv = sum(k.map((x) => R.months[x].rev)), ex = sum(k.map((x) => R.months[x].exp));
    const margin = rv ? (rv - ex) / rv : 0;
    add(margin > 0.1 ? "good" : margin > 0 ? "warn" : "bad", `Profit margin ${(margin < 0 ? "−" : "") + pa(margin)} over the last 3 months`,
      `${money(rv - ex)} left after ${money(ex)} of costs.`);
    const cats: Record<string, number> = {}, pcats: Record<string, number> = {};
    k.forEach((x) => Object.entries(R.months[x].cats).forEach(([c, v]) => (cats[c] = (cats[c] || 0) + v)));
    const pk = R.monthKeys.slice(-6, -3);
    pk.forEach((x) => Object.entries(R.months[x].cats).forEach(([c, v]) => (pcats[c] = (pcats[c] || 0) + v)));
    const prevRev = sum(pk.map((x) => R.months[x].rev));
    if (pk.length === 3 && prevRev && rv) {
      const rising = Object.keys(cats)
        .filter((c) => pcats[c] > ex * 0.05)
        .map((c) => ({ c, g: cats[c] / rv / (pcats[c] / prevRev) - 1 }))
        .sort((a, b) => b.g - a.g)[0];
      if (rising && rising.g > 0.06)
        add("warn", `${rising.c} costs are growing faster than sales`, `As a share of revenue they are up ${pct(rising.g)} on the previous 3 months.`);
    }
  }
  const order: Record<Tone, number> = { bad: 0, warn: 1, good: 2, info: 3 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}
