#!/usr/bin/env bash
# Fix stored Minecraft username casing via Mojang for existing accounts.
# Does not use Hypixel (no scan quota).
set -euo pipefail

BASE_URL="${PITANTIR_URL:-http://localhost:3000}"
SCOPE="${1:-watchlist}"

if [[ ! "$SCOPE" =~ ^(watchlist|contacts|all)$ ]]; then
  echo "Usage: $0 [watchlist|contacts|all]"
  exit 1
fi

if ! curl -sf -m 3 "$BASE_URL/api/accounts" >/dev/null; then
  echo "Web app not reachable at $BASE_URL"
  echo "Start it first: npx pnpm@10.11.0 restart:web"
  exit 1
fi

echo "Fixing username casing (scope=$SCOPE) at $BASE_URL …"
# Mojang lookups are sequential with a short delay; large lists can take a few minutes.
RESP="$(curl -sS -X POST "$BASE_URL/api/accounts/fix-usernames" \
  -H "Content-Type: application/json" \
  -d "{\"scope\":\"$SCOPE\"}" \
  --max-time 900)"

python3 -c '
import json,sys
body=json.loads(sys.argv[1])
if "error" in body:
    print("ERROR:", body["error"])
    sys.exit(1)
print(body.get("message", body))
changed=[r for r in body.get("results",[]) if r.get("changed") and r.get("previousUsername")!=r.get("mcUsername")]
for r in changed[:30]:
    print("  %s → %s" % (r["previousUsername"], r["mcUsername"]))
if len(changed)>30:
    print("  …and %d more" % (len(changed)-30))
' "$RESP"
