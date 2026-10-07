-- Checks that row-level security keeps each owner's data private.
-- Run after stub_auth.sql and the migrations; any failed check raises an error.
\set ON_ERROR_STOP 1

create function pg_temp.expect_denied(stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'expected to be denied: %', stmt;
exception when insufficient_privilege or check_violation then
  null;
end $$;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into businesses (name, currency) values ('Alice Co', 'GBP');
insert into imports (business_id, kind, file_name, row_count) select id, 'sales', 'a.csv', 1 from businesses;
insert into sales (business_id, import_id, sold_on, customer, amount)
  select b.id, i.id, '2026-01-02', 'x', 10 from businesses b join imports i on i.business_id = b.id;
insert into expenses (business_id, spent_on, category, amount) select id, '2026-01-02', 'Rent', 100 from businesses;

do $$ begin
  assert (select count(*) from sales) = 1, 'owner sees their sales';
  assert (select owner_id from businesses) = auth.uid(), 'owner_id defaults to the signed-in user';
end $$;

reset role;
select id as alice_biz from businesses \gset

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  assert (select count(*) from businesses) = 0, 'other users see no businesses';
  assert (select count(*) from sales) = 0, 'other users see no sales';
  assert (select count(*) from expenses) = 0, 'other users see no expenses';
  assert (select count(*) from imports) = 0, 'other users see no imports';
end $$;
select pg_temp.expect_denied(format('insert into sales (business_id, sold_on, amount) values (%L, ''2026-01-01'', 5)', :'alice_biz'));
select pg_temp.expect_denied('insert into businesses (owner_id, name) values (''11111111-1111-1111-1111-111111111111'', ''spoof'')');
update businesses set name = 'hacked';
delete from sales;

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  assert (select name from businesses) = 'Alice Co', 'other users cannot rename a business';
  assert (select count(*) from sales) = 1, 'other users cannot delete sales';
end $$;
select pg_temp.expect_denied('insert into businesses (name, currency) values (''Bad'', ''XYZ'')');

delete from imports;
do $$ begin
  assert (select count(*) from sales) = 0, 'removing an import removes its sales';
  assert (select count(*) from expenses) = 1, 'expenses not tied to the import stay';
end $$;

reset role;
select 'RLS checks passed' as result;
