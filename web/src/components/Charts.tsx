"use client";

import {
  BarController, BarElement, CategoryScale, Chart as ChartJS, Filler, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip,
  type ChartOptions,
} from "chart.js";
import { useEffect, useState } from "react";
import { Bar, Chart, Line } from "react-chartjs-2";
import type { Analysis } from "@/lib/analytics";
import { shortDate, type Money } from "@/lib/format";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, LineController, BarController, Filler, Tooltip, Legend);

type Palette = Record<"ink" | "muted" | "line" | "accent" | "forecast" | "forecastSoft" | "font", string>;

/** Chart colours come from the CSS tokens so charts follow light and dark mode. */
function usePalette(): Palette | null {
  const [p, setP] = useState<Palette | null>(null);
  useEffect(() => {
    const read = () => {
      const s = getComputedStyle(document.documentElement);
      const v = (n: string) => s.getPropertyValue(n).trim();
      setP({ ink: v("--ink"), muted: v("--muted"), line: v("--line"), accent: v("--accent"), forecast: v("--forecast"), forecastSoft: v("--forecast-soft"), font: getComputedStyle(document.body).fontFamily });
    };
    read();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);
  return p;
}

function axes(p: Palette, money: Money) {
  return {
    x: { grid: { display: false }, ticks: { maxTicksLimit: 8, color: p.muted, font: { family: p.font } } },
    y: { grid: { color: p.line }, border: { display: false }, ticks: { color: p.muted, font: { family: p.font }, callback: (v: string | number) => money(Number(v), true) } },
  };
}

export function ForecastChart({ R, money }: { R: Analysis; money: Money }) {
  const p = usePalette();
  if (!p) return null;
  const show = Math.min(R.weeks.length, 64);
  const actual = R.weeks.slice(-show), dates = R.weekEnds.slice(-show), f = R.forecast;
  const pad = (n: number) => new Array<number | null>(n).fill(null);
  const join = actual.length - 1, last = actual[join];
  const datasets = [
    { label: "Weekly sales", data: [...actual, ...(f ? pad(12) : [])], borderColor: p.accent, backgroundColor: p.accent, borderWidth: 2, pointRadius: 0, tension: 0.25 },
    ...(f
      ? [
          { label: "Range high", data: [...pad(join), last, ...f.hi], borderColor: "transparent", pointRadius: 0, fill: false },
          { label: "Likely range", data: [...pad(join), last, ...f.lo], borderColor: "transparent", backgroundColor: p.forecastSoft, pointRadius: 0, fill: "-1" as const },
          { label: "Forecast", data: [...pad(join), last, ...f.values], borderColor: p.forecast, backgroundColor: p.forecast, borderDash: [6, 4], borderWidth: 2, pointRadius: 0 },
        ]
      : []),
  ];
  const options: ChartOptions<"line"> = {
    responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, scales: axes(p, money),
    plugins: {
      legend: { labels: { color: p.ink, boxWidth: 12, font: { family: p.font }, filter: (i) => i.text !== "Range high" } },
      tooltip: { filter: (i) => i.dataset.label !== "Range high" && i.raw != null, callbacks: { label: (c) => `${c.dataset.label}: ${money(Number(c.raw))}` } },
    },
  };
  return <Line data={{ labels: [...dates, ...(f ? f.dates : [])].map(shortDate), datasets }} options={options} aria-label="Weekly sales with forecast" role="img" />;
}

export function ProductsChart({ R, money }: { R: Analysis; money: Money }) {
  const p = usePalette();
  if (!p || !R.products) return null;
  const top = R.products.slice(0, 8);
  const a = axes(p, money);
  const options: ChartOptions<"bar"> = {
    indexAxis: "y", responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => money(Number(c.raw)) } } },
    scales: { x: { ...a.y }, y: { grid: { display: false }, ticks: { color: p.ink, font: { family: p.font } } } },
  };
  return <Bar data={{ labels: top.map((x) => x.name), datasets: [{ label: "Revenue", data: top.map((x) => x.v), backgroundColor: p.accent, borderRadius: 4 }] }} options={options} aria-label="Top products by revenue" role="img" />;
}

export function CostChart({ R, money }: { R: Analysis; money: Money }) {
  const p = usePalette();
  if (!p) return null;
  const mk = R.monthKeys.slice(-18);
  const label = (k: string) => {
    const [y, m] = k.split("-");
    return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
  };
  const datasets = [
    { type: "bar" as const, label: "Revenue", data: mk.map((k) => R.months[k].rev), backgroundColor: p.accent, borderRadius: 3, order: 2 },
    ...(R.hasExp
      ? [
          { type: "bar" as const, label: "Costs", data: mk.map((k) => R.months[k].exp), backgroundColor: p.line, borderRadius: 3, order: 2 },
          { type: "line" as const, label: "Profit", data: mk.map((k) => R.months[k].rev - R.months[k].exp), borderColor: p.forecast, backgroundColor: p.forecast, pointRadius: 2, borderWidth: 2, order: 1 },
        ]
      : []),
  ];
  return (
    <Chart
      type="bar"
      data={{ labels: mk.map(label), datasets }}
      options={{
        responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, scales: axes(p, money),
        plugins: { legend: { labels: { color: p.ink, boxWidth: 12, font: { family: p.font } } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(Number(c.raw))}` } } },
      }}
      aria-label="Revenue and costs by month"
      role="img"
    />
  );
}
