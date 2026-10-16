#!/usr/bin/env bash
# Points Supabase sign-in emails at the live site. Needs SUPABASE_ACCESS_TOKEN, SUPABASE_REF and SITE_URL.
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?}" "${SUPABASE_REF:?}" "${SITE_URL:?}"
API="https://api.supabase.com/v1/projects/$SUPABASE_REF/config/auth"
AUTH=(-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json")

current=$(curl -fsS "${AUTH[@]}" "$API" | jq -r '.uri_allow_list // ""')
# Keep anything already allowed (local dev, previews) and add the live callback.
allow=$(printf '%s\n' "${current//,/$'\n'}" "$SITE_URL/**" "http://localhost:3000/**" | sed '/^$/d' | sort -u | paste -sd, -)
body=$(jq -n --arg site "$SITE_URL" --arg allow "$allow" '{site_url: $site, uri_allow_list: $allow}')
curl -fsS -X PATCH "${AUTH[@]}" "$API" -d "$body" | jq '{site_url, uri_allow_list}'
