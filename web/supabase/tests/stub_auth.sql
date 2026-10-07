-- Minimal stand-in for the parts of Supabase auth the migrations rely on, so
-- they can be tested against plain Postgres in CI.
create extension if not exists pgcrypto;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant usage on schema public to authenticated;
alter default privileges in schema public grant all on tables to authenticated;
alter default privileges in schema public grant all on sequences to authenticated;
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
