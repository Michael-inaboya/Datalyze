import type { Expense, Kind, Sale } from "./types";

export type Cell = string | number | null | undefined;
export type Row = Cell[];
export type DateOrder = "DMY" | "MDY";

/** A row as it comes out of a preset or the column mapping, before cleaning. */
export type RawRecord = {
  date: Cell;
  amount: Cell;
  customer?: Cell;
  category?: Cell;
  product?: Cell;
  quantity?: Cell;
  order?: Cell;
};

export function parseAmount(v: Cell): number {
  if (typeof v === "number") return v;
  if (v == null) return NaN;
  let s = String(v).trim();
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[^0-9.,]/g, "");
  if (/,\d{1,2}$/.test(s) && s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", "."); // 1.234,56
  else s = s.replace(/,/g, "");
  const n = parseFloat(s);
  return neg ? -n : n;
}

/** Decide whether slash dates are day-first. Falls back to the given default when every date is ambiguous. */
export function dateOrder(values: Cell[], fallback: DateOrder): DateOrder {
  for (const v of values) {
    const m = String(v ?? "").match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (m && +m[1] > 12) return "DMY";
    if (m && +m[2] > 12) return "MDY";
  }
  return fallback;
}

export function parseDate(v: Cell, order: DateOrder): number {
  if (v == null || v === "") return NaN;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const [d, mo] = order === "MDY" ? [+m[2], +m[1]] : [+m[1], +m[2]];
    return Date.UTC(y, mo - 1, d);
  }
  const t = Date.parse(s);
  if (isNaN(t)) return NaN;
  const d = new Date(t);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

export type Field = { key: keyof RawRecord; label: string; req: boolean; re: RegExp };

export const FIELDS: Record<Kind, Field[]> = {
  sales: [
    { key: "date", label: "Date", req: true, re: /date|time|day|created|ordered/i },
    { key: "customer", label: "Customer", req: true, re: /customer|client|buyer|email|account|name/i },
    { key: "amount", label: "Amount", req: true, re: /amount|total|revenue|sales|price|value|paid/i },
    { key: "product", label: "Product (optional)", req: false, re: /product|item|sku|description|service/i },
    { key: "quantity", label: "Quantity (optional)", req: false, re: /qty|quantity|units/i },
  ],
  expenses: [
    { key: "date", label: "Date", req: true, re: /date|time|day|paid/i },
    { key: "category", label: "Category", req: true, re: /category|type|account|description|expense|vendor/i },
    { key: "amount", label: "Amount", req: true, re: /amount|total|cost|value|paid|debit|spent|money out|net/i },
  ],
};

export function guessColumns(kind: Kind, headers: string[]): Record<string, string> {
  const used = new Set<string>();
  const map: Record<string, string> = {};
  for (const f of FIELDS[kind]) {
    const h = headers.find((h) => h && !used.has(h) && f.re.test(h));
    map[f.key] = h ?? "";
    if (h) used.add(h);
  }
  return map;
}

/* ---------- known exports from UK/US tools, read without column matching ---------- */

const col = (h: string[], ...names: string[]) => {
  for (const n of names) {
    const i = h.findIndex((x) => String(x ?? "").trim().toLowerCase() === n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
};
const cell = (r: Row, i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");

export type Preset = { name: string; test: (headers: string[]) => boolean; parse: (headers: string[], rows: Row[]) => RawRecord[] };

export const PRESETS: Preset[] = [
  {
    name: "Shopify orders export",
    test: (h) => col(h, "Lineitem name") >= 0 && col(h, "Created at") >= 0,
    parse(h, rows) {
      const I = (n: string) => col(h, n);
      const first: Record<string, { date: string; customer: string; status: string }> = {};
      return rows.flatMap((r) => {
        const id = cell(r, I("Name"));
        // Shopify fills order-level fields only on the first line of each order
        const o = (first[id] ||= {
          date: cell(r, I("Created at")),
          customer: cell(r, I("Email")) || cell(r, I("Billing Name")),
          status: cell(r, I("Financial Status")),
        });
        if (/refunded|voided|pending/i.test(o.status)) return [];
        const qty = parseAmount(cell(r, I("Lineitem quantity"))) || 1;
        const amount = parseAmount(cell(r, I("Lineitem price"))) * qty - (parseAmount(cell(r, I("Lineitem discount"))) || 0);
        return [{ date: o.date, customer: o.customer, amount, product: cell(r, I("Lineitem name")), quantity: qty, order: id }];
      });
    },
  },
  {
    name: "Stripe payments export",
    test: (h) => col(h, "Created date (UTC)", "Created (UTC)") >= 0 && col(h, "Amount") >= 0,
    parse(h, rows) {
      const d = col(h, "Created date (UTC)", "Created (UTC)"), a = col(h, "Amount"), rf = col(h, "Amount Refunded"), st = col(h, "Status");
      const ce = col(h, "Customer Email"), cd = col(h, "Customer Description"), ci = col(h, "Customer ID"), id = col(h, "id");
      return rows
        .filter((r) => !/fail|cancel|block/i.test(cell(r, st)))
        .map((r) => ({
          date: cell(r, d),
          customer: cell(r, ce) || cell(r, cd) || cell(r, ci),
          amount: parseAmount(cell(r, a)) - (parseAmount(cell(r, rf)) || 0),
          product: null,
          quantity: 1,
          order: cell(r, id),
        }));
    },
  },
  {
    name: "Square sales export",
    test: (h) => col(h, "Net Sales") >= 0 && col(h, "Transaction ID") >= 0,
    parse(h, rows) {
      const it = col(h, "Item"), q = col(h, "Qty");
      return rows.map((r) => ({
        date: cell(r, col(h, "Date")),
        customer: cell(r, col(h, "Customer Name")) || cell(r, col(h, "Customer ID")),
        amount: parseAmount(cell(r, col(h, "Net Sales"))),
        product: it >= 0 ? cell(r, it) : null,
        quantity: q >= 0 ? parseAmount(cell(r, q)) || 1 : 1,
        order: cell(r, col(h, "Transaction ID")),
      }));
    },
  },
  {
    name: "QuickBooks sales report",
    test: (h) => col(h, "Transaction Type") >= 0 && col(h, "Amount") >= 0 && col(h, "Date") >= 0,
    parse(h, rows) {
      const d = col(h, "Date"), cu = col(h, "Customer", "Customer full name", "Name"), pr = col(h, "Product/Service", "Product/Service full name");
      const q = col(h, "Qty", "Quantity"), a = col(h, "Amount"), t = col(h, "Transaction Type"), n = col(h, "Num", "No.");
      let group = "";
      const out: RawRecord[] = [];
      for (const r of rows) {
        const lead = cell(r, 0);
        const filled = r.filter((x) => String(x ?? "").trim()).length;
        // "Sales by Customer Detail" groups rows under a customer heading and closes with "Total for ..."
        if (/^total/i.test(lead)) continue;
        if (filled === 1 && lead) {
          group = lead;
          continue;
        }
        if (/payment|deposit|journal|transfer/i.test(cell(r, t))) continue;
        out.push({
          date: cell(r, d),
          customer: cell(r, cu) || group,
          amount: parseAmount(cell(r, a)),
          product: pr >= 0 ? cell(r, pr) : null,
          quantity: q >= 0 ? parseAmount(cell(r, q)) || 1 : 1,
          order: cell(r, n),
        });
      }
      return out;
    },
  },
];

/** Accounting reports put a title block above the real header row; find it. */
export function readTable(data: Row[]): { headers: string[]; raw: Row[] } {
  const looksLikeHeader = (r: Row) => {
    const h = r.map((x) => String(x ?? "").trim());
    return h.filter(Boolean).length >= 3 && (PRESETS.some((p) => p.test(h)) || h.some((x) => /date|created/i.test(x)));
  };
  const idx = Math.max(0, data.slice(0, 30).findIndex(looksLikeHeader));
  const headers = (data[idx] ?? []).map((x) => String(x ?? "").trim());
  return { headers, raw: data.slice(idx + 1).filter((r) => r.some((x) => String(x ?? "").trim())) };
}

export function detectPreset(headers: string[]): Preset | undefined {
  return PRESETS.find((p) => p.test(headers));
}

export function applyMapping(headers: string[], rows: Row[], map: Record<string, string>): RawRecord[] {
  const idx = (k: string) => (map[k] ? headers.indexOf(map[k]) : -1);
  const get = (r: Row, k: string) => {
    const i = idx(k);
    return i >= 0 ? r[i] : undefined;
  };
  return rows.map((r) => ({
    date: get(r, "date"),
    amount: get(r, "amount"),
    customer: get(r, "customer"),
    category: get(r, "category"),
    product: map.product ? get(r, "product") : null,
    quantity: map.quantity ? get(r, "quantity") : 1,
  }));
}

export type Cleaned<T> = { rows: T[]; skipped: number };

export function cleanSales(raw: RawRecord[], fallback: DateOrder): Cleaned<Sale> {
  const order = dateOrder(raw.slice(0, 500).map((r) => r.date), fallback);
  const rows: Sale[] = [];
  let skipped = 0;
  for (const r of raw) {
    const date = parseDate(r.date, order);
    const amount = parseAmount(r.amount);
    if (isNaN(date) || isNaN(amount)) {
      skipped++;
      continue;
    }
    rows.push({
      date,
      amount,
      customer: String(r.customer ?? "").trim(),
      product: r.product == null ? null : String(r.product).trim() || "Other",
      quantity: parseAmount(r.quantity) || 1,
      order: r.order ? String(r.order) : null,
    });
  }
  return { rows, skipped };
}

export function cleanExpenses(raw: RawRecord[], fallback: DateOrder): Cleaned<Expense> {
  const order = dateOrder(raw.slice(0, 500).map((r) => r.date), fallback);
  const rows: Expense[] = [];
  let skipped = 0;
  for (const r of raw) {
    const date = parseDate(r.date, order);
    const amount = parseAmount(r.amount);
    if (isNaN(date) || isNaN(amount)) {
      skipped++;
      continue;
    }
    rows.push({ date, category: String(r.category ?? "").trim() || "Other", amount: Math.abs(amount) });
  }
  return { rows, skipped };
}
