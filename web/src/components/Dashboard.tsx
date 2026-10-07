"use client";

import { useMemo, useState } from "react";
import { analyze, buildInsights, type Analysis, type Tier } from "@/lib/analytics";
import { moneyFormatter, pa, pct } from "@/lib/format";
import type { Currency, Expense, Sale } from "@/lib/types";
import { CostChart, ForecastChart, ProductsChart } from "./Charts";

const CHIP = { good: "Good", warn: "Watch", bad: "Act", info: "Note" } as const;
const TIER_COLOR: Record<Tier, string> = { High: "var(--bad)", Medium: "var(--warn)", Low: "var(--good)", Lapsed: "var(--muted)" };
const FILTERS: { tier: Tier | "All"; label: string }[] = [
  { tier: "High", label: "High risk" },
  { tier: "Medium", label: "Medium risk" },
  { tier: "Lapsed", label: "Already lapsed" },
  { tier: "All", label: "All customers" },
];

function Kpi({ label, value, delta, good }: { label: string; value: string; delta?: string | null; good?: boolean }) {
  return (
    <div className="kpi">
      <span className="lab">{label}</span>
      <span className="val">{value}</span>
      <span className={`delta ${delta == null ? "" : good ? "up" : "down"}`}>{delta ?? " "}</span>
    </div>
  );
}

export function Dashboard({ sales, expenses, currency }: { sales: Sale[]; expenses: Expense[]; currency: Currency }) {
  const R = useMemo(() => analyze(sales, expenses), [sales, expenses]);
  const money = useMemo(() => moneyFormatter(currency), [currency]);
  const insights = useMemo(() => buildInsights(R, money), [R, money]);
  return (
    <>
      <Kpis R={R} money={money} />
      <section className="panel">
        <h2>What your data is telling you</h2>
        <p className="sub">Generated automatically from your sales, customers and costs.</p>
        <ul className="insights">
          {insights.map((i) => (
            <li key={i.title}>
              <span className={`chip ${i.tone}`}>{CHIP[i.tone]}</span>
              <div>
                <div className="t">{i.title}</div>
                <div className="d">{i.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>Weekly sales and 12-week forecast</h2>
        <p className="sub">Shaded area is the likely range (80%). Model: damped-trend exponential smoothing, tuned to your history.</p>
        <div className="fstats">
          {R.forecast ? (
            <>
              <div><b>{money(R.forecast.next4, true)}</b><span>Next 4 weeks</span></div>
              <div><b>{money(R.forecast.next12, true)}</b><span>Next 12 weeks</span></div>
              {R.forecast.backtest && (
                <div><b>{(100 - R.forecast.backtest.err * 100).toFixed(0)}%</b><span>Accuracy on the last 8 weeks (tested)</span></div>
              )}
            </>
          ) : (
            <div><span>The forecast needs at least 10 weeks of sales history.</span></div>
          )}
        </div>
        <div className="chartbox"><ForecastChart R={R} money={money} /></div>
      </section>
      <ChurnTable R={R} money={money} />
      <div className="two">
        <section className="panel">
          <h2>Top products, last 90 days</h2>
          <p className="sub">{R.products ? "Revenue by product." : "Your sales data has no product column."}</p>
          {R.products && <div className="chartbox"><ProductsChart R={R} money={money} /></div>}
        </section>
        <section className="panel">
          <h2>Revenue and costs by month</h2>
          <p className="sub">{R.hasExp ? "Monthly revenue, costs, and what is left as profit." : "Add an expenses file to see costs and profit."}</p>
          <div className="chartbox"><CostChart R={R} money={money} /></div>
        </section>
      </div>
    </>
  );
}

function Kpis({ R, money }: { R: Analysis; money: ReturnType<typeof moneyFormatter> }) {
  const d = (a: number, b: number) => (b ? `${pct(a / b - 1)} vs previous period` : null);
  const margin = R.rev90 ? (R.rev90 - R.exp90) / R.rev90 : 0;
  return (
    <section className="kpis" aria-label="Key numbers">
      <Kpi label="Sales, last 30 days" value={money(R.rev30, true)} delta={d(R.rev30, R.revPrev30)} good={R.rev30 >= R.revPrev30} />
      <Kpi label="Active customers (90 days)" value={R.active.toLocaleString()} delta={R.activePrev ? `${pct(R.active / R.activePrev - 1)} vs previous 90 days` : null} good={R.active >= R.activePrev} />
      <Kpi label="Average order" value={money(R.aov90)} delta={d(R.aov90, R.aovPrev90)} good={R.aov90 >= R.aovPrev90} />
      {R.hasExp ? (
        <Kpi label="Profit margin, 90 days" value={(margin < 0 ? "−" : "") + pa(margin, 1)} delta={`${money(R.rev90 - R.exp90, true)} profit`} good={margin > 0} />
      ) : (
        <Kpi label="Sales at risk from churn" value={money(R.revAtRisk, true)} delta={`${R.atRisk.length} customers, per year`} good={false} />
      )}
    </section>
  );
}

function ChurnTable({ R, money }: { R: Analysis; money: ReturnType<typeof moneyFormatter> }) {
  const [tier, setTier] = useState<Tier | "All">("High");
  const list = R.custs
    .filter((c) => tier === "All" || c.tier === tier)
    .sort((a, b) => (tier === "All" ? b.risk - a.risk : b.yearly * b.risk - a.yearly * a.risk));
  return (
    <section className="panel">
      <h2>Customers likely to leave</h2>
      <p className="sub">Risk compares how long since each customer last bought with how often they usually buy, and whether their spending is falling.</p>
      <div className="tabs" role="group" aria-label="Filter by risk" style={{ marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button key={f.tier} type="button" aria-pressed={tier === f.tier} onClick={() => setTier(f.tier)}>{f.label}</button>
        ))}
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Customer</th><th>Risk</th><th className="num">Last bought</th><th className="num">Usually every</th><th className="num">Orders</th><th className="num">Yearly value</th><th>Suggested action</th></tr>
          </thead>
          <tbody>
            {list.slice(0, 40).map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td><span className="bar"><i style={{ width: `${Math.round(c.risk * 100)}%`, background: TIER_COLOR[c.tier] }} /></span>{c.tier} · {Math.round(c.risk * 100)}%</td>
                <td className="num">{Math.round(c.recency)} days ago</td>
                <td className="num">{c.orders > 1 ? `${Math.round(c.expected)} days` : "One order"}</td>
                <td className="num">{c.orders}</td>
                <td className="num">{money(c.yearly)}</td>
                <td>{c.action}</td>
              </tr>
            ))}
            {list.length > 40 && <tr><td colSpan={7} className="note">Showing the 40 most valuable of {list.length}.</td></tr>}
            {!list.length && <tr><td colSpan={7} className="empty">No customers in this group.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
