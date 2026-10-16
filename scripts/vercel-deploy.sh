#!/usr/bin/env bash
# Fixes the Vercel project settings, builds web/ and deploys it to production.
# Needs VERCEL_TOKEN, NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
# Optional VERCEL_PROJECT (name, default "datalyze"). Writes site_url to $GITHUB_OUTPUT.
set -euo pipefail
: "${VERCEL_TOKEN:?}" "${NEXT_PUBLIC_SUPABASE_URL:?}" "${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?}"
PROJECT="${VERCEL_PROJECT:-datalyze}"
V="https://api.vercel.com"
AUTH=(-H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json")

# The project may sit in the personal account or in a team.
TEAM=""
find_project() { curl -fsS "${AUTH[@]}" "$V/v9/projects/$PROJECT${1:+?teamId=$1}" 2>/dev/null; }
if ! info=$(find_project ""); then
  for t in $(curl -fsS "${AUTH[@]}" "$V/v2/teams" | jq -r '.teams[].id'); do
    if info=$(find_project "$t"); then TEAM=$t; break; fi
  done
fi
if [[ -z ${info:-} ]]; then
  echo "::error::No Vercel project called '$PROJECT' is visible to this token. Set the VERCEL_PROJECT repository variable to its name." >&2
  exit 1
fi
Q=${TEAM:+?teamId=$TEAM}
PID=$(jq -r .id <<<"$info")
echo "Vercel project: $(jq -r .name <<<"$info") ($PID), root directory was '$(jq -r '.rootDirectory // ""' <<<"$info")'"

# The app lives in web/, not at the repo root; this is what caused DEPLOYMENT_NOT_FOUND.
curl -fsS -X PATCH "${AUTH[@]}" "$V/v9/projects/$PID$Q" \
  -d '{"rootDirectory":"web","framework":"nextjs"}' | jq '{name, rootDirectory, framework}'

# Keep the project's own env in step so Git-triggered builds work too.
for key in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; do
  body=$(jq -n --arg k "$key" --arg v "${!key}" '{key: $k, value: $v, type: "plain", target: ["production", "preview", "development"]}')
  sep=${Q:+&}; sep=${sep:-?}
  if ! curl -fsS -o /dev/null -X POST "${AUTH[@]}" "$V/v10/projects/$PID/env$Q${sep}upsert=true" -d "$body"; then
    echo "::warning::Could not set $key on the Vercel project (an integration may own it). This deploy still uses the right value."
  fi
done

export VERCEL_ORG_ID=$(jq -r .accountId <<<"$info") VERCEL_PROJECT_ID=$PID
cd "$(dirname "$0")/.."
npx --yes vercel@latest pull --yes --environment=production --token "$VERCEL_TOKEN"
# Build with this project's Supabase keys whatever the dashboard holds (an add-on may have set others).
{
  echo "NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL"
  echo "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
} >>.vercel/.env.production.local
npx --yes vercel@latest build --prod --token "$VERCEL_TOKEN"
url=$(npx --yes vercel@latest deploy --prebuilt --prod --token "$VERCEL_TOKEN")
echo "Deployed $url"

# Prefer the project's own domain over the per-deployment address.
domain=$(curl -fsS "${AUTH[@]}" "$V/v9/projects/$PID/domains$Q" | jq -r '[.domains[] | select(.redirect == null and .gitBranch == null) | .name] | (map(select(endswith(".vercel.app") | not)) + .)[0] // empty')
site="https://${domain:-${url#https://}}"
echo "Site: $site"
echo "site_url=$site" >>"${GITHUB_OUTPUT:-/dev/null}"
