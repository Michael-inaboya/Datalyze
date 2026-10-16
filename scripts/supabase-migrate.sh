#!/usr/bin/env bash
# Applies web/supabase/migrations/*.sql that haven't run yet, through the
# Supabase Management API. Needs SUPABASE_ACCESS_TOKEN and SUPABASE_REF.
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?}" "${SUPABASE_REF:?}"
API="https://api.supabase.com/v1/projects/$SUPABASE_REF"
DIR="$(dirname "$0")/../web/supabase/migrations"

query() {
  local body out code
  body=$(jq -n --arg q "$1" '{query: $q}')
  out=$(curl -sS -w '\n%{http_code}' -X POST "$API/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d "$body")
  code=${out##*$'\n'}
  out=${out%$'\n'*}
  if [[ $code != 2* ]]; then
    echo "::error::Supabase query failed ($code): $out" >&2
    return 1
  fi
  printf '%s' "$out"
}

query "create schema if not exists datalyze_meta;
create table if not exists datalyze_meta.migrations (name text primary key, applied_at timestamptz not null default now());
revoke all on schema datalyze_meta from anon, authenticated;" >/dev/null

# The first migration may already have been run by hand in the SQL editor.
query "insert into datalyze_meta.migrations (name)
select '0001_init.sql' where to_regclass('public.businesses') is not null
on conflict do nothing;" >/dev/null

applied=$(query "select name from datalyze_meta.migrations" | jq -r '.[].name')
for f in "$DIR"/*.sql; do
  name=$(basename "$f")
  if grep -qxF "$name" <<<"$applied"; then
    echo "Already applied: $name"
    continue
  fi
  echo "Applying $name"
  query "begin;
$(cat "$f")
insert into datalyze_meta.migrations (name) values ('$name');
commit;" >/dev/null
done

tables=$(query "select count(*) as n from information_schema.tables where table_schema = 'public' and table_name in ('businesses','imports','sales','expenses')" | jq -r '.[0].n')
if [[ $tables != 4 ]]; then
  echo "::error::Expected 4 Datalyze tables, found $tables" >&2
  exit 1
fi
echo "Database is up to date."
