import type { SupabaseClient } from "@supabase/supabase-js";
import { isoDay } from "./format";
import { sampleBusiness, SAMPLE_NAME } from "./sample";
import type { Currency, Expense, Kind, Sale } from "./types";

export type Business = { id: string; name: string; currency: Currency };
export type ImportRecord = {
  id: string;
  kind: Kind;
  file_name: string;
  source: string | null;
  row_count: number;
  skipped: number;
  created_at: string;
};
export type ImportMeta = { fileName: string; source: string | null; skipped: number };

/** Everything the screens need from storage. The demo and Supabase versions behave the same. */
export interface Store {
  readonly demo: boolean;
  listBusinesses(): Promise<Business[]>;
  createBusiness(name: string, currency: Currency): Promise<Business>;
  updateBusiness(id: string, patch: Partial<Pick<Business, "name" | "currency">>): Promise<void>;
  loadSales(businessId: string): Promise<Sale[]>;
  loadExpenses(businessId: string): Promise<Expense[]>;
  listImports(businessId: string): Promise<ImportRecord[]>;
  addSales(businessId: string, rows: Sale[], meta: ImportMeta): Promise<void>;
  addExpenses(businessId: string, rows: Expense[], meta: ImportMeta): Promise<void>;
  deleteImport(businessId: string, importId: string): Promise<void>;
}

const toDay = (d: string) => Date.parse(d + "T00:00:00Z");
const PAGE = 1000;
const BATCH = 1000;

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export function supabaseStore(db: SupabaseClient): Store {
  async function all<T>(table: string, columns: string, businessId: string, orderBy: string): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const page = check(
        await db.from(table).select(columns).eq("business_id", businessId).order(orderBy).order("id").range(from, from + PAGE - 1),
      ) as T[];
      out.push(...page);
      if (page.length < PAGE) return out;
    }
  }

  async function addImport(businessId: string, kind: Kind, meta: ImportMeta, count: number): Promise<string> {
    const row = check(
      await db
        .from("imports")
        .insert({ business_id: businessId, kind, file_name: meta.fileName, source: meta.source, row_count: count, skipped: meta.skipped })
        .select("id")
        .single(),
    ) as { id: string };
    return row.id;
  }

  async function insertAll(table: string, rows: Record<string, unknown>[], importId: string) {
    try {
      for (let i = 0; i < rows.length; i += BATCH) check(await db.from(table).insert(rows.slice(i, i + BATCH)));
    } catch (e) {
      // Undo a half-finished import so the history and the data stay in step.
      await db.from("imports").delete().eq("id", importId);
      throw e;
    }
  }

  return {
    demo: false,
    async listBusinesses() {
      return check(await db.from("businesses").select("id, name, currency").order("created_at")) as Business[];
    },
    async createBusiness(name, currency) {
      return check(await db.from("businesses").insert({ name, currency }).select("id, name, currency").single()) as Business;
    },
    async updateBusiness(id, patch) {
      check(await db.from("businesses").update(patch).eq("id", id));
    },
    async loadSales(businessId) {
      type R = { sold_on: string; customer: string; product: string | null; quantity: number; amount: number; order_ref: string | null };
      const rows = await all<R>("sales", "id, sold_on, customer, product, quantity, amount, order_ref", businessId, "sold_on");
      return rows.map((r) => ({
        date: toDay(r.sold_on), customer: r.customer, product: r.product, quantity: Number(r.quantity), amount: Number(r.amount), order: r.order_ref,
      }));
    },
    async loadExpenses(businessId) {
      type R = { spent_on: string; category: string; amount: number };
      const rows = await all<R>("expenses", "id, spent_on, category, amount", businessId, "spent_on");
      return rows.map((r) => ({ date: toDay(r.spent_on), category: r.category, amount: Number(r.amount) }));
    },
    async listImports(businessId) {
      return check(
        await db.from("imports").select("id, kind, file_name, source, row_count, skipped, created_at").eq("business_id", businessId).order("created_at", { ascending: false }),
      ) as ImportRecord[];
    },
    async addSales(businessId, rows, meta) {
      const importId = await addImport(businessId, "sales", meta, rows.length);
      await insertAll(
        "sales",
        rows.map((r) => ({
          business_id: businessId, import_id: importId, sold_on: isoDay(r.date), customer: r.customer,
          product: r.product, quantity: r.quantity, amount: Math.round(r.amount * 100) / 100, order_ref: r.order,
        })),
        importId,
      );
    },
    async addExpenses(businessId, rows, meta) {
      const importId = await addImport(businessId, "expenses", meta, rows.length);
      await insertAll(
        "expenses",
        rows.map((r) => ({
          business_id: businessId, import_id: importId, spent_on: isoDay(r.date), category: r.category, amount: Math.round(r.amount * 100) / 100,
        })),
        importId,
      );
    },
    async deleteImport(businessId, importId) {
      // sales and expenses rows go with it (on delete cascade)
      check(await db.from("imports").delete().eq("id", importId).eq("business_id", businessId));
    },
  };
}

/** In-memory store preloaded with the sample business. Nothing is saved. */
export function demoStore(): Store {
  const sample = sampleBusiness();
  const biz: Business = { id: "demo", name: SAMPLE_NAME, currency: "USD" };
  const created = "2026-09-30T12:00:00.000Z"; // fixed, so the demo page can be prerendered
  type Batch<T> = { record: ImportRecord; rows: T[] };
  const sales: Batch<Sale>[] = [
    { record: { id: "sample-sales", kind: "sales", file_name: "Sample sales", source: "Sample data", row_count: sample.sales.length, skipped: 0, created_at: created }, rows: sample.sales },
  ];
  const expenses: Batch<Expense>[] = [
    { record: { id: "sample-expenses", kind: "expenses", file_name: "Sample expenses", source: "Sample data", row_count: sample.expenses.length, skipped: 0, created_at: created }, rows: sample.expenses },
  ];
  const record = (kind: Kind, meta: ImportMeta, count: number): ImportRecord => ({
    id: crypto.randomUUID(), kind, file_name: meta.fileName, source: meta.source, row_count: count, skipped: meta.skipped, created_at: new Date().toISOString(),
  });
  return {
    demo: true,
    async listBusinesses() { return [biz]; },
    async createBusiness() { return biz; },
    async updateBusiness(_id, patch) { Object.assign(biz, patch); },
    async loadSales() { return sales.flatMap((b) => b.rows); },
    async loadExpenses() { return expenses.flatMap((b) => b.rows); },
    async listImports() {
      return [...sales, ...expenses].map((b) => b.record).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async addSales(_id, rows, meta) { sales.push({ record: record("sales", meta, rows.length), rows }); },
    async addExpenses(_id, rows, meta) { expenses.push({ record: record("expenses", meta, rows.length), rows }); },
    async deleteImport(_id, importId) {
      for (const list of [sales, expenses] as Batch<unknown>[][]) {
        const i = list.findIndex((b) => b.record.id === importId);
        if (i >= 0) list.splice(i, 1);
      }
    },
  };
}
