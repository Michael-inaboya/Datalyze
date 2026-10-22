"use client";

import { Fragment, useRef, useState, type ReactNode } from "react";

type Turn = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Why did sales change last month?",
  "Which customers should I contact this week?",
  "What will the next 4 weeks look like?",
  "Which products are growing, and which are slipping?",
];
const MAX_TURNS = 20; // matches the server's limit

/** Renders the small subset of markdown the analyst is told to use: "- " lists and **bold**. */
function Answer({ text }: { text: string }) {
  const bold = (line: string): ReactNode[] =>
    line.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <Fragment key={i}>{part}</Fragment>));
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{bold(l)}</li>)}</ul>);
    list = [];
  };
  for (const line of text.split("\n")) {
    const item = line.match(/^\s*[-*•]\s+(.*)$/);
    if (item) list.push(item[1]);
    else {
      flush();
      if (line.trim()) blocks.push(<p key={blocks.length}>{bold(line.replace(/^#+\s*/, ""))}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}

export function AskPanel({ businessId, demo }: { businessId: string; demo: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function ask(q: string) {
    q = q.trim();
    if (!q || busy) return;
    // keep the most recent exchanges, starting on a question
    const history = turns.slice(-(MAX_TURNS - 2));
    const sent: Turn[] = [...history, { role: "user", content: q }];
    setTurns([...sent, { role: "assistant", content: "" }]);
    setQuestion("");
    setError(null);
    setBusy(true);
    const ctl = (abort.current = new AbortController());
    let answer = "";
    try {
      const res = await fetch("/api/analyst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, turns: sent }),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "The analyst couldn't answer that. Try again.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setTurns([...sent, { role: "assistant", content: answer }]);
      }
      if (!answer.trim()) throw new Error("The analyst didn't return an answer. Try again.");
    } catch (e) {
      if (ctl.signal.aborted) answer = answer.trim() ? answer + "\n\n(Stopped.)" : "";
      else {
        setError((e as Error).message);
        answer = "";
      }
      // drop an unanswered question so the history stays question, answer, question...
      setTurns(answer ? [...sent, { role: "assistant", content: answer }] : history);
      if (!answer) setQuestion(q);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <section className="panel ask" aria-labelledby="askTitle">
      <h2 id="askTitle">Ask Datalyze</h2>
      <p className="sub">
        Ask a question about your sales, customers, costs or forecast and get an answer in plain English.
        {demo && " In the demo, answers use the sample coffee roaster's data."}
      </p>
      {turns.length > 0 && (
        <div className="chat" aria-live="polite">
          {turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="q">{t.content}</div>
            ) : (
              <div key={i} className="a">{t.content ? <Answer text={t.content} /> : <p className="note">Looking at your numbers…</p>}</div>
            ),
          )}
        </div>
      )}
      {turns.length === 0 && (
        <div className="tabs" style={{ marginBottom: 12 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => ask(s)}>{s}</button>
          ))}
        </div>
      )}
      <form className="askform" onSubmit={(e) => { e.preventDefault(); ask(question); }}>
        <input
          type="text"
          aria-label="Your question"
          placeholder="For example: who were my best customers in the summer?"
          maxLength={1000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        {busy ? (
          <button type="button" onClick={() => abort.current?.abort()}>Stop</button>
        ) : (
          <button className="primary" type="submit" disabled={!question.trim()}>Ask</button>
        )}
      </form>
      {error && <p className="error" role="alert" style={{ marginTop: 8 }}>{error}</p>}
      {turns.length > 0 && !busy && (
        <p className="note" style={{ marginTop: 8 }}>
          Answers are generated by AI from your data and can be wrong, so check anything important.{" "}
          <button type="button" className="linkish" onClick={() => { setTurns([]); setError(null); }}>Start over</button>
        </p>
      )}
    </section>
  );
}
