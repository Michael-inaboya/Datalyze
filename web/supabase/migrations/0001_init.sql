-- Datalyze schema: each signed-in user owns one or more businesses; every row
-- of sales, expenses and import history belongs to a business, and row-level
-- security limits all access to the business owner.

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  currency text not null default 'USD' check (currency in ('USD', 'GBP', 'EUR', 'CAD', 'AUD')),
  created_at timestamptz not null default now()
);
create index businesses_owner_idx on public.businesses (owner_id);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('sales', 'expenses')),
  file_name text not null,
  source text,
  row_count integer not null default 0,
  skipped integer not null default 0,
  created_at timestamptz not null default now()
);
create index imports_business_idx on public.imports (business_id, created_at desc);

create table public.sales (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  import_id uuid references public.imports (id) on delete cascade,
  sold_on date not null,
  customer text not null default '',
  product text,
  quantity numeric not null default 1,
  amount numeric(14, 2) not null,
  order_ref text
);
create index sales_business_date_idx on public.sales (business_id, sold_on);
create index sales_import_idx on public.sales (import_id);

create table public.expenses (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  import_id uuid references public.imports (id) on delete cascade,
  spent_on date not null,
  category text not null,
  amount numeric(14, 2) not null
);
create index expenses_business_date_idx on public.expenses (business_id, spent_on);
create index expenses_import_idx on public.expenses (import_id);

-- Ownership check used by every child-table policy. Security definer so the
-- lookup itself is not filtered by RLS on businesses.
create or replace function public.owns_business(bid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.businesses b where b.id = bid and b.owner_id = (select auth.uid())
  );
$$;

alter table public.businesses enable row level security;
alter table public.imports enable row level security;
alter table public.sales enable row level security;
alter table public.expenses enable row level security;

create policy "Owners manage their businesses" on public.businesses
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Owners manage imports" on public.imports
  for all to authenticated
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id));

create policy "Owners manage sales" on public.sales
  for all to authenticated
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id));

create policy "Owners manage expenses" on public.expenses
  for all to authenticated
  using (public.owns_business(business_id))
  with check (public.owns_business(business_id));
