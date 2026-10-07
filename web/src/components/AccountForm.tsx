"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase/client";

export function AccountForm() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase().auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else {
      setDone(true);
      setPassword("");
    }
  }

  return (
    <form className="panel form" onSubmit={submit}>
      <div>
        <h1>Change your password</h1>
        <p className="sub">Use at least 8 characters.</p>
      </div>
      <label htmlFor="newPassword">New password
        <input id="newPassword" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      {done && <p className="ok" role="status">Password changed.</p>}
      <div className="controls">
        <button className="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
        <Link className="btn" href="/app">Back to dashboard</Link>
      </div>
    </form>
  );
}
