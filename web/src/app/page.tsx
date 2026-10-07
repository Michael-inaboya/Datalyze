import Link from "next/link";
import { Logo } from "@/components/Logo";
import { supabaseConfigured } from "@/lib/supabase/config";

const FEATURES = [
  { title: "Connect your data", body: "Upload exports from Shopify, Stripe, Square or QuickBooks and they are read automatically. Any other spreadsheet works with a quick column match." },
  { title: "Insights in plain English", body: "See what changed, what to act on and what is going well, ranked so the urgent things come first." },
  { title: "Sales forecast", body: "A 12-week forecast with a likely range, tested against your own recent weeks so you know how far to trust it." },
  { title: "Customers about to leave", body: "Spot regulars who have gone quiet compared with how often they usually buy, with a suggested next step for each." },
];

export default function Home() {
  return (
    <div className="wrap">
      <header className="top">
        <Logo />
        <nav className="controls">
          <Link className="btn" href="/demo">Try the demo</Link>
          {supabaseConfigured && <Link className="btn primary" href="/login">Sign in</Link>}
        </nav>
      </header>
      <section className="hero">
        <h1>Know what your sales data is telling you, without hiring an analyst.</h1>
        <p>Datalyze turns your sales, customer and cost records into a clear weekly picture: what is growing, what is slipping, what next month looks like and who to call before they stop buying.</p>
        <div className="controls">
          <Link className="btn primary" href={supabaseConfigured ? "/login?mode=signup" : "/demo"}>
            {supabaseConfigured ? "Create a free account" : "Open the demo"}
          </Link>
          {supabaseConfigured && <Link className="btn" href="/demo">See it with sample data</Link>}
        </div>
      </section>
      <section className="features">
        {FEATURES.map((f) => (
          <div className="panel" key={f.title}>
            <h2>{f.title}</h2>
            <p>{f.body}</p>
          </div>
        ))}
      </section>
      <p className="foot">Datalyze is in early development.</p>
    </div>
  );
}
