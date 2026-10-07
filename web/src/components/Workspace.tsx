"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { fmtDate } from "@/lib/format";
import { demoStore, supabaseStore, type Business, type ImportRecord, type Store } from "@/lib/store";
import { supabase } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/config";
import { CURRENCIES, type Currency, type Expense, type Sale } from "@/lib/types";
import { Dashboard } from "./Dashboard";
import { DataPanel } from "./DataPanel";
import { Logo } from "./Logo";

type View = "dashboard" | "data";
type Data = { sales: Sale[]; expenses: Expense[]; imports: ImportRecord[] };

export function Workspace({ mode }: { mode: "demo" | "live" }) {
  const router = useRouter();
  const store = useMemo<Store>(() => (mode === "demo" || !supabaseConfigured ? demoStore() : supabaseStore(supabase())), [mode]);
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [bizId, setBizId] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [error, setError] = useState("");
  const biz = businesses?.find((b) => b.id === bizId) ?? null;

  useEffect(() => {
    store.listBusinesses().then(
      (list) => {
        setBusinesses(list);
        let saved: string | null = null;
        try { saved = localStorage.getItem("dz-business"); } catch {}
        setBizId(list.find((b) => b.id === saved)?.id ?? list[0]?.id ?? null);
      },
      (e: Error) => setError(e.message),
    );
  }, [store]);

  const reload = useCallback(async (id: string) => {
    const [sales, expenses, imports] = await Promise.all([store.loadSales(id), store.loadExpenses(id), store.listImports(id)]);
    setData({ sales, expenses, imports });
  }, [store]);

  useEffect(() => {
    if (!bizId) return;
    try { localStorage.setItem("dz-business", bizId); } catch {}
    let cancelled = false;
    Promise.all([store.loadSales(bizId), store.loadExpenses(bizId), store.listImports(bizId)]).then(
      ([sales, expenses, imports]) => {
        if (cancelled) return;
        setData({ sales, expenses, imports });
        if (!sales.length) setView("data");
      },
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => { cancelled = true; };
  }, [bizId, store]);

  async function signOut() {
    await supabase().auth.signOut();
    router.replace("/login");
  }

  async function setCurrency(currency: Currency) {
    if (!biz) return;
    await store.updateBusiness(biz.id, { currency });
    setBusinesses((list) => list?.map((b) => (b.id === biz.id ? { ...b, currency } : b)) ?? null);
  }

  const header = (
    <header className="top">
      <div className="brand">
        <Logo />
        {store.demo && <span className="pill accent">Demo with sample data</span>}
      </div>
      <div className="controls">
        {businesses && businesses.length > 1 && (
          <select aria-label="Business" value={bizId ?? ""} onChange={(e) => { setData(null); setBizId(e.target.value); }}>
            {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        {biz && (
          <select aria-label="Currency" value={biz.currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
            {(Object.keys(CURRENCIES) as Currency[]).map((c) => <option key={c} value={c}>{CURRENCIES[c]} {c}</option>)}
          </select>
        )}
        {store.demo ? (
          supabaseConfigured ? <Link className="btn primary" href="/login?mode=signup">Create your account</Link> : null
        ) : (
          <>
            <Link className="btn" href="/app/account">Account</Link>
            <button type="button" onClick={signOut}>Sign out</button>
          </>
        )}
      </div>
    </header>
  );

  if (error) {
    return <div className="wrap">{header}<section className="panel"><h2>Something went wrong</h2><p className="error">{error}</p><p className="note">Reload the page to try again.</p></section></div>;
  }
  if (!businesses) return <div className="wrap">{header}<p className="note">Loading your workspace…</p></div>;
  if (!biz) {
    return (
      <div className="wrap">
        {header}
        <NewBusiness onCreate={async (name, currency) => { const b = await store.createBusiness(name, currency); setBusinesses([b]); setBizId(b.id); }} />
      </div>
    );
  }

  return (
    <div className="wrap">
      {header}
      <div className="source">
        <span><b>{biz.name}</b></span>
        {data && data.sales.length > 0 && (
          <span>{data.sales.length.toLocaleString()} sales from {fmtDate(Math.min(...data.sales.map((s) => s.date)))} to {fmtDate(Math.max(...data.sales.map((s) => s.date)))}</span>
        )}
        <span className="tabs" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "dashboard"} onClick={() => setView("dashboard")}>Dashboard</button>
          <button type="button" aria-pressed={view === "data"} onClick={() => setView("data")}>Data</button>
        </span>
      </div>
      {!data ? (
        <p className="note">Loading your data…</p>
      ) : view === "data" || !data.sales.length ? (
        <DataPanel
          currency={biz.currency}
          imports={data.imports}
          onSales={async (rows, meta) => { await store.addSales(biz.id, rows, meta); await reload(biz.id); }}
          onExpenses={async (rows, meta) => { await store.addExpenses(biz.id, rows, meta); await reload(biz.id); }}
          onDelete={async (id) => { await store.deleteImport(biz.id, id); await reload(biz.id); }}
        />
      ) : (
        <Dashboard sales={data.sales} expenses={data.expenses} currency={biz.currency} />
      )}
      {store.demo && <p className="foot">The sample business and its data are generated, not real. Files you add in the demo are not saved.</p>}
    </div>
  );
}

function NewBusiness({ onCreate }: { onCreate: (name: string, currency: Currency) => Promise<void> }) {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onCreate(name.trim(), currency);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the business.");
      setBusy(false);
    }
  }
  return (
    <form className="panel form" onSubmit={submit} style={{ maxWidth: 480 }}>
      <div>
        <h1>Set up your business</h1>
        <p className="sub">Your sales and costs are kept private to your account.</p>
      </div>
      <label htmlFor="bizName">Business name
        <input id="bizName" type="text" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label htmlFor="bizCurrency">Currency
        <select id="bizCurrency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
          {(Object.keys(CURRENCIES) as Currency[]).map((c) => <option key={c} value={c}>{CURRENCIES[c]} {c}</option>)}
        </select>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="controls"><button className="primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Continue"}</button></div>
    </form>
  );
}
