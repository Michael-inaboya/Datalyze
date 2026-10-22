-- Live connections to outside services (Stripe first). The API key is encrypted
-- by the app server before it is stored, so the database never holds it in plain text.

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  provider text not null check (provider in ('stripe')),
  account_name text,
  secret text not null,
  -- Unix time of the newest payment already synced; the next sync starts after it.
  synced_until bigint not null default 0,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (business_id, provider)
);

alter table public.connections enable row level security;

create policy "Owners manage connections" on public.connections
  for all to authenticated
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id));

-- Synced batches show up in the import history; disconnecting keeps the data.
alter table public.imports add column connection_id uuid references public.connections (id) on delete set null;
