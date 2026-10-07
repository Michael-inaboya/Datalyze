# Datalyze: MVP plan

Affordable business intelligence for small businesses that have no data analyst.

## Who it is for
**Launch market: UK and US** (decided 7 Oct 2026). Owner-run SMEs (shops, cafés, salons, distributors, online sellers) with 20 to 5,000 customers, who keep sales in a POS, Shopify, QuickBooks/Xero or a spreadsheet.

## What the prototype does today (`app/index.html`)
Runs entirely in the browser, no server, data never leaves the device.
- **Connect data**: upload a sales CSV and an expenses CSV; columns are auto-matched and can be corrected.
- **Automatic insights**: plain-English findings ranked Act / Watch / Good / Note (sales change, product winners and losers, customer concentration, repeat rate, busiest day, profit margin, costs rising faster than sales).
- **Sales forecast**: 12-week weekly forecast with an 80% range, using damped-trend exponential smoothing tuned to the business's own history, plus an honest backtest on the last 8 weeks.
- **Churn risk**: each customer's time since last purchase vs their own usual buying gap, adjusted for falling spend; tiers High / Medium / Lapsed with yearly value and a suggested action.
- **Reads UK/US exports directly**, with no column matching: Shopify orders, Stripe payments, Square sales (items or transactions) and QuickBooks "Sales by Customer Detail". Anything else goes through the column-matching step. Walk-in or guest sales count toward revenue and forecasts but not churn.
- Currency picker (USD, GBP, EUR and others). US-style dates (MM/DD) are assumed when the currency is USD and the file is ambiguous.

## MVP roadmap
1. **Accounts and saved workspaces** (built in `web/`): sign-in, one workspace per business, data stored securely with row-level security.
2. **Live connectors** instead of CSV, in this order: Stripe, Shopify, Square, QuickBooks Online, Xero (UK), Google Sheets. All have OAuth APIs; nightly sync. Expense exports from QuickBooks and Xero get presets next.
3. **Better models** once data is stored: seasonality-aware forecasts (Prophet or ETS with yearly seasonality), a trained churn model (gradient boosting on RFM features) where a business has enough history.
4. **AI analyst**: Claude writes the weekly summary and answers questions like "why were sales down in March?" over the business's own numbers.
5. **Alerts**: weekly email / Slack digest with the top 3 actions.
6. **Pricing**: free tier (CSV, 1 data source), paid tier around $29 / £25 a month with connectors, alerts and AI questions, billed through Stripe.
7. **Compliance**: UK GDPR and US state privacy basics (data processing agreement, deletion on request, EU/UK data residency option).

## Recommended production stack
- **Web app**: Next.js (React, TypeScript), Tailwind, Chart.js or Recharts.
- **Backend + DB + auth**: Supabase (Postgres, row-level security per business, auth, storage).
- **Analytics service**: Python (FastAPI) with pandas, statsmodels, scikit-learn for forecasting and churn, run as scheduled jobs.
- **AI**: Claude API for narrative insights and Q&A.
- **Hosting**: Vercel (web) + Fly.io or Render (Python service). Low fixed cost, which keeps the product affordable.

## Repository layout
- `web/`: the Next.js + Supabase app (sign-in, saved businesses, imports, dashboard). See [web/README.md](web/README.md) to run and deploy it.
- `app/index.html`: the original single-file prototype. Open it in any browser.
- `samples/`: example Shopify, Stripe, Square and QuickBooks exports for testing imports.
