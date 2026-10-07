"use client";

import Papa from "papaparse";
import { useState } from "react";
import {
  applyMapping, cleanExpenses, cleanSales, detectPreset, FIELDS, guessColumns, readTable, type DateOrder, type RawRecord, type Row,
} from "@/lib/importers";
import type { ImportMeta, ImportRecord } from "@/lib/store";
import type { Currency, Expense, Kind, Sale } from "@/lib/types";

type Pending = { kind: Kind; fileName: string; headers: string[]; raw: Row[]; map: Record<string, string> };

type Props = {
  currency: Currency;
  imports: ImportRecord[];
  onSales: (rows: Sale[], meta: ImportMeta) => Promise<void>;
  onExpenses: (rows: Expense[], meta: ImportMeta) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function DataPanel({ currency, imports, onSales, onExpenses, onDelete }: Props) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Ambiguous dates like 03/04/2026 are read US-style for dollar businesses.
  const fallback: DateOrder = currency === "USD" ? "MDY" : "DMY";

  async function save(kind: Kind, raw: RawRecord[], fileName: string, source: string | null): Promise<boolean> {
    if (kind === "sales") {
      const { rows, skipped } = cleanSales(raw, fallback);
      if (!rows.length) return false;
      await onSales(rows, { fileName, source, skipped });
      setStatus(`Added ${rows.length.toLocaleString()} sales from ${fileName}${skipped ? `. ${skipped} rows were skipped because the date or amount could not be read` : ""}.`);
    } else {
      const { rows, skipped } = cleanExpenses(raw, fallback);
      if (!rows.length) return false;
      await onExpenses(rows, { fileName, source, skipped });
      setStatus(`Added ${rows.length.toLocaleString()} expenses from ${fileName}${skipped ? `. ${skipped} rows were skipped` : ""}.`);
    }
    return true;
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? `Could not save: ${e.message}` : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function onFile(kind: Kind, file: File) {
    setStatus("");
    setError("");
    Papa.parse<Row>(file, {
      skipEmptyLines: true,
      complete: (res) => {
        const { headers, raw } = readTable(res.data);
        if (!raw.length) return setError(`${file.name} has no rows we could read. Check that it is a CSV with a header row.`);
        const preset = kind === "sales" ? detectPreset(headers) : undefined;
        if (preset) {
          return run(async () => {
            if (!(await save("sales", preset.parse(headers, raw), file.name, preset.name)))
              setError(`${file.name} looks like a ${preset.name}, but no rows had a readable date and amount.`);
          });
        }
        setPending({ kind, fileName: file.name, headers, raw, map: guessColumns(kind, headers) });
      },
      error: (err) => setError(`Could not read ${file.name}: ${err.message}`),
    });
  }

  function confirmMapping() {
    if (!pending) return;
    const missing = FIELDS[pending.kind].filter((f) => f.req && !pending.map[f.key]).map((f) => f.label);
    if (missing.length) return setError(`Choose a column for: ${missing.join(", ")}.`);
    run(async () => {
      if (await save(pending.kind, applyMapping(pending.headers, pending.raw, pending.map), pending.fileName, null)) setPending(null);
      else setError("No rows had a readable date and amount with these columns. Try different columns.");
    });
  }

  return (
    <>
      <section className="panel form">
        <div>
          <h2>Add data</h2>
          <p className="sub">
            Shopify orders, Stripe payments, Square sales and QuickBooks &ldquo;Sales by Customer Detail&rdquo; exports are recognised automatically. Any other CSV works after you match its columns.
            Sales need a <code>date</code>, <code>customer</code> and <code>amount</code>; expenses need a <code>date</code>, <code>category</code> and <code>amount</code>.
          </p>
        </div>
        <div className="controls">
          <label className="btn primary" htmlFor="salesFile">
            Upload sales CSV
            <input type="file" id="salesFile" accept=".csv,text/csv" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile("sales", f); e.target.value = ""; }} />
          </label>
          <label className="btn" htmlFor="expFile">
            Upload expenses CSV
            <input type="file" id="expFile" accept=".csv,text/csv" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile("expenses", f); e.target.value = ""; }} />
          </label>
          {busy && <span className="note">Saving…</span>}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {status && <p className="ok" role="status">{status}</p>}
      </section>

      {pending && (
        <section className="panel form">
          <div>
            <h2>Match your columns: {pending.fileName}</h2>
            <p className="sub">{pending.raw.length.toLocaleString()} rows found. We guessed which column is which. Fix anything that looks wrong, then add the file.</p>
          </div>
          <div className="mapgrid">
            {FIELDS[pending.kind].map((f) => (
              <label key={f.key} htmlFor={`map-${f.key}`}>
                {f.label}
                <select id={`map-${f.key}`} value={pending.map[f.key] ?? ""} onChange={(e) => setPending({ ...pending, map: { ...pending.map, [f.key]: e.target.value } })}>
                  <option value="">{f.req ? "Choose a column" : "None"}</option>
                  {pending.headers.filter(Boolean).map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="controls">
            <button className="primary" type="button" onClick={confirmMapping} disabled={busy}>Add this file</button>
            <button type="button" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Your files</h2>
        <p className="sub">Removing a file removes all the sales or expenses it added.</p>
        <div className="tablewrap">
          <table>
            <thead><tr><th>File</th><th>Type</th><th>Read as</th><th className="num">Rows</th><th>Added</th><th /></tr></thead>
            <tbody>
              {imports.map((i) => (
                <tr key={i.id}>
                  <td>{i.file_name}</td>
                  <td>{i.kind === "sales" ? "Sales" : "Expenses"}</td>
                  <td>{i.source ?? "Matched columns"}</td>
                  <td className="num">{i.row_count.toLocaleString()}{i.skipped ? ` (${i.skipped} skipped)` : ""}</td>
                  <td>{new Date(i.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</td>
                  <td className="num">
                    {confirmId === i.id ? (
                      <span className="controls" style={{ justifyContent: "flex-end" }}>
                        <button type="button" className="danger" disabled={busy} onClick={() => run(async () => { await onDelete(i.id); setConfirmId(null); })}>Remove</button>
                        <button type="button" onClick={() => setConfirmId(null)}>Keep</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmId(i.id)}>Remove…</button>
                    )}
                  </td>
                </tr>
              ))}
              {!imports.length && <tr><td colSpan={6} className="empty">No files yet. Upload a sales CSV to get started.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
