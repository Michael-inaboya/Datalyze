"use client";

import { useState, type FormEvent } from "react";
import type { Connection } from "@/lib/store";

type Props = {
  demo: boolean;
  businessId: string;
  connection: Connection | null;
  syncing: boolean;
  onSync: () => Promise<string>;
  onChanged: () => Promise<void>;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function syncSummary(r: { added?: number; otherCurrency?: number; alreadyHad?: number }) {
  const parts = [`Added ${(r.added ?? 0).toLocaleString()} new payment${r.added === 1 ? "" : "s"}`];
  if (r.alreadyHad) parts.push(`${r.alreadyHad.toLocaleString()} were already here`);
  if (r.otherCurrency) parts.push(`${r.otherCurrency.toLocaleString()} in other currencies were left out`);
  return parts.join(". ") + ".";
}

export function StripeConnect({ demo, businessId, connection, syncing, onSync, onChanged }: Props) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [confirm, setConfirm] = useState(false);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function connect(e: FormEvent) {
    e.preventDefault();
    act(async () => {
      const res = await fetch("/api/stripe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId, key }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't connect.");
      setKey("");
      await onChanged();
      setStatus(body.syncError ? `Connected, but the first sync failed: ${body.syncError}` : `Connected. ${syncSummary(body)}`);
    });
  }

  function disconnect() {
    act(async () => {
      const res = await fetch(`/api/stripe?businessId=${encodeURIComponent(businessId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't disconnect.");
      setConfirm(false);
      await onChanged();
      setStatus("Disconnected. Payments already synced are still in your data.");
    });
  }

  if (demo) {
    return (
      <section className="panel form">
        <div>
          <h2>Connect Stripe</h2>
          <p className="sub">With an account, Datalyze pulls your Stripe payments in automatically and keeps them up to date. The demo can&rsquo;t connect.</p>
        </div>
      </section>
    );
  }

  if (connection) {
    return (
      <section className="panel form">
        <div>
          <h2>Stripe <span className="pill accent">Connected</span></h2>
          <p className="sub">
            {connection.account_name ? `${connection.account_name}. ` : ""}
            New payments sync when you open Datalyze, at most every few hours.
            {connection.last_synced_at ? ` Last synced ${when(connection.last_synced_at)}.` : ""}
          </p>
        </div>
        {connection.last_error && <p className="error" role="alert">Last sync failed: {connection.last_error}</p>}
        <div className="controls">
          <button type="button" className="primary" disabled={busy || syncing} onClick={() => act(async () => setStatus(await onSync()))}>
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          {confirm ? (
            <>
              <button type="button" className="danger" disabled={busy} onClick={disconnect}>Disconnect</button>
              <button type="button" onClick={() => setConfirm(false)}>Keep</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirm(true)}>Disconnect…</button>
          )}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {status && <p className="ok" role="status">{status}</p>}
      </section>
    );
  }

  return (
    <form className="panel form" onSubmit={connect}>
      <div>
        <h2>Connect Stripe</h2>
        <p className="sub">
          Datalyze reads your payments with a read-only restricted key, then keeps them up to date. In Stripe, open{" "}
          <a href="https://dashboard.stripe.com/apikeys/create" target="_blank" rel="noreferrer">Create restricted key</a>, name it Datalyze, set{" "}
          <b>Charges</b> to <b>Read</b>, leave everything else as None, and paste the key here.
          It&rsquo;s stored encrypted.
        </p>
      </div>
      <label htmlFor="stripeKey">Restricted key
        <input id="stripeKey" type="password" autoComplete="off" spellCheck={false} placeholder="rk_live_…" required value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      <div className="controls">
        <button className="primary" type="submit" disabled={busy || !key.trim()}>{busy ? "Connecting and syncing…" : "Connect"}</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {status && <p className="ok" role="status">{status}</p>}
    </form>
  );
}
