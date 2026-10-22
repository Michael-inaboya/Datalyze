# Datalyze web app

Next.js app with Supabase for sign-in and storage. Each signed-in user creates a business, uploads sales and expense CSVs, and gets the dashboard: KPIs, plain-English insights, a 12-week sales forecast and customers at risk of leaving.

## Run it locally

```bash
cd web
npm install
cp .env.example .env.local   # optional: add Supabase keys
npm run dev                  # http://localhost:3000
```

Without Supabase keys the app runs in demo-only mode: `/demo` shows the sample business and `/app` redirects there.

## Connect Supabase

1. Create a project at [supabase.com](https://supabase.com) (the free tier is enough to start).
2. In the SQL editor, run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). It creates the tables and the row-level security policies that keep each owner's data private.
3. Under Authentication > URL Configuration, set the Site URL to your app's address and add `https://<your-domain>/auth/callback` to the redirect URLs.
4. Copy the project URL and publishable key (or, on older projects, the anon key) from Project Settings > API into `.env.local`, and into your host's environment variables when deploying.

## Deploy

Import the repository into [Vercel](https://vercel.com), set the root directory to `web`, and add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

The [Deploy workflow](../.github/workflows/deploy.yml) does this on every push to `main` (or from the Actions tab) once two repository secrets exist:

- `SUPABASE_ACCESS_TOKEN` (supabase.com/dashboard/account/tokens): applies new migrations and sets the sign-in redirect URLs.
- `VERCEL_TOKEN` (vercel.com/account/tokens): sets the root directory and env vars on the Vercel project, deploys, and checks the live pages.

Set the `VERCEL_PROJECT` repository variable if the Vercel project isn't `datalyze-euqy`.

## Stripe connection

Owners connect Stripe on the Data screen with a read-only restricted key (Charges: Read). The key is encrypted with AES-256-GCM using `DATALYZE_SECRET_KEY` (32 random bytes, base64) before it's stored in `connections`; the deploy workflow creates that variable on Vercel the first time and never replaces it. Payments sync on connect, on "Sync now", and when the owner opens Datalyze more than six hours after the last sync. Successful charges become sales (net of refunds at sync time), charges in other currencies are skipped, and charge ids already present (for example from a Stripe CSV) aren't added twice.

For local development, set `DATALYZE_SECRET_KEY` in `.env.local` (`openssl rand -base64 32`).

## AI analyst

The "Ask Datalyze" panel on the dashboard answers owners' questions with Claude (`claude-opus-5-5`, via `@anthropic-ai/sdk`). `POST /api/analyst` loads the business's data as the signed-in owner (so row-level security applies), sends Claude a JSON summary built with the same `analyze()` the dashboard uses (`src/lib/analystData.ts`), and gives it a `breakdown` tool for finer questions such as one customer's history or a product by month. Replies stream back as plain text. Server-side refusal fallbacks are on (`fallbacks: "default"`). The demo answers from the sample business and is limited to a few questions an hour per visitor.

Add the key as the `ANTHROPIC_API_KEY` GitHub secret; the deploy workflow copies it to Vercel as a sensitive variable. Locally, put it in `.env.local`.

## Checks

```bash
npm run lint
npm run typecheck
npm test        # importer and analytics unit tests
npm run build
```

CI also applies the migration to Postgres and runs [`supabase/tests/rls_test.sql`](supabase/tests/rls_test.sql), which checks that one user can never read or change another user's data.

## Layout

- `src/lib/importers.ts`: CSV reading, including Shopify, Stripe, Square and QuickBooks presets
- `src/lib/analytics.ts`: KPIs, forecast, churn risk and insight generation
- `src/lib/store.ts`: data access, with a Supabase version and an in-memory demo version
- `src/components/`: dashboard, charts, data import and workspace screens
- `src/lib/stripe.ts`, `src/lib/stripeApi.ts`, `src/app/api/stripe/`: Stripe connection and sync
- `src/proxy.ts`: keeps the session fresh and protects `/app`
