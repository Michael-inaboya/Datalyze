#!/usr/bin/env bash
# Fixes the Vercel project settings and deploys main to production.
# Needs VERCEL_TOKEN, NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
# Optional VERCEL_PROJECT (name, default "datalyze-euqy"). Writes site_url to $GITHUB_OUTPUT.
set -euo pipefail
: "${VERCEL_TOKEN:?}" "${NEXT_PUBLIC_SUPABASE_URL:?}" "${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?}"
PROJECT="${VERCEL_PROJECT:-datalyze-euqy}"
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
    echo "::warning::Could not set $key on the Vercel project (an integration may own it). Set it in Vercel > Settings > Environment Variables."
  fi
done

# Server-side key that encrypts connected accounts' API keys. Created once and never replaced,
# because changing it would make stored keys unreadable.
envs=$(curl -fsS "${AUTH[@]}" "$V/v9/projects/$PID/env$Q" | jq -r '.envs[].key')
if ! grep -qx DATALYZE_SECRET_KEY <<<"$envs"; then
  body=$(jq -n --arg v "$(openssl rand -base64 32)" '{key: "DATALYZE_SECRET_KEY", value: $v, type: "sensitive", target: ["production", "preview"]}')
  curl -fsS -o /dev/null -X POST "${AUTH[@]}" "$V/v10/projects/$PID/env$Q" -d "$body"
  echo "Created DATALYZE_SECRET_KEY"
fi

# Have Vercel build from GitHub itself; building with the CLI from a subfolder breaks next/font.
body=$(jq -n --arg name "$(jq -r .name <<<"$info")" --arg pid "$PID" --arg repo "${GITHUB_REPOSITORY:-Michael-inaboya/Datalyze}" \
  '{name: $name, project: $pid, target: "production",
    gitSource: {type: "github", org: ($repo | split("/")[0]), repo: ($repo | split("/")[1]), ref: "main"}}')
dep=$(curl -sS -X POST "${AUTH[@]}" "$V/v13/deployments$Q" -d "$body")
jq -e .id <<<"$dep" >/dev/null || { echo "::error::Vercel refused the deployment: $(jq -c .error <<<"$dep")" >&2; exit 1; }
did=$(jq -r .id <<<"$dep")
echo "Started deployment $did (https://$(jq -r .url <<<"$dep"))"
for _ in $(seq 1 90); do
  state=$(curl -fsS "${AUTH[@]}" "$V/v13/deployments/$did$Q" | jq -r .readyState)
  case $state in
    READY) break ;;
    ERROR|CANCELED) echo "::error::Vercel deployment $did ended $state. See the build log on vercel.com." >&2; exit 1 ;;
  esac
  sleep 10
done
[[ $state == READY ]] || { echo "::error::Vercel deployment $did still $state after 15 minutes" >&2; exit 1; }
url="https://$(jq -r .url <<<"$dep")"
echo "Deployed $url"

# Prefer the project's own domain over the per-deployment address.
domain=$(curl -fsS "${AUTH[@]}" "$V/v9/projects/$PID/domains$Q" | jq -r '[.domains[] | select(.redirect == null and .gitBranch == null) | .name] | (map(select(endswith(".vercel.app") | not)) + .)[0] // empty')
site="https://${domain:-${url#https://}}"
echo "Site: $site"
echo "site_url=$site" >>"${GITHUB_OUTPUT:-/dev/null}"
