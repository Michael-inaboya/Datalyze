"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/config";

type Mode = "signin" | "signup" | "reset";

export function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(params.get("error") === "link" ? "That link has expired or was already used. Sign in, or ask for a new link." : "");
  const [message, setMessage] = useState("");
  const next = params.get("next")?.startsWith("/app") ? params.get("next")! : "/app";

  if (!supabaseConfigured) {
    return (
      <div className="panel">
        <h1>Sign-in is not set up yet</h1>
        <p className="sub">This copy of Datalyze has no database connected. You can still explore everything with sample data.</p>
        <Link className="btn primary" href="/demo">Open the demo</Link>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const db = supabase();
    const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    try {
      if (mode === "signin") {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else if (mode === "signup") {
        const { data, error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        if (data.session) {
          router.replace(next);
          router.refresh();
        } else setMessage(`Check ${email} for a link to confirm your account.`);
      } else {
        const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/app/account` });
        if (error) throw error;
        setMessage(`If ${email} has an account, a reset link is on its way.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<Mode, string> = { signin: "Sign in", signup: "Create your account", reset: "Reset your password" };
  return (
    <form className="panel form" onSubmit={submit}>
      <div>
        <h1>{titles[mode]}</h1>
        <p className="sub">
          {mode === "signup" ? "Free while Datalyze is in early access." : mode === "reset" ? "We will email you a link to choose a new password." : "Welcome back."}
        </p>
      </div>
      <label htmlFor="email">Email
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {mode !== "reset" && (
        <label htmlFor="password">Password
          <input id="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="ok" role="status">{message}</p>}
      <div className="controls">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Working…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
        </button>
      </div>
      <div className="controls note">
        {mode !== "signin" && <button type="button" className="linkish" onClick={() => setMode("signin")}>I have an account</button>}
        {mode !== "signup" && <button type="button" className="linkish" onClick={() => setMode("signup")}>Create an account</button>}
        {mode === "signin" && <button type="button" className="linkish" onClick={() => setMode("reset")}>Forgot password?</button>}
      </div>
    </form>
  );
}
