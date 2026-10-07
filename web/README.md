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
- `src/proxy.ts`: keeps the session fresh and protects `/app`
