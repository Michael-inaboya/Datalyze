import { CURRENCIES, type Currency } from "./types";

export type Money = (value: number, compact?: boolean) => string;

export function moneyFormatter(currency: Currency): Money {
  const symbol = CURRENCIES[currency] ?? "$";
  return (v, compact) => {
    const a = Math.abs(v);
    let n: string;
    if (compact && a >= 1e6) n = (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + "M";
    else if (compact && a >= 1e4) n = (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "k";
    else
      n = a.toLocaleString("en-US", {
        maximumFractionDigits: a < 100 ? 2 : 0,
        minimumFractionDigits: a < 100 && a % 1 ? 2 : 0,
      });
    return (v < 0 ? "−" : "") + symbol + n;
  };
}

/** Unsigned percentage, e.g. 0.123 -> "12%" */
export const pa = (v: number, d = 0) => Math.abs(v * 100).toFixed(d) + "%";

/** Signed percentage, e.g. -0.05 -> "−5%"; zero has no sign */
export const pct = (v: number, d = 0) => {
  const body = Math.abs(v * 100).toFixed(d);
  const sign = body === (0).toFixed(d) ? "" : v > 0 ? "+" : "−";
  return sign + body + "%";
};

export const fmtDate = (d: number) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const shortDate = (d: number) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export const isoDay = (d: number) => new Date(d).toISOString().slice(0, 10);
