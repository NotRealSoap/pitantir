#!/usr/bin/env bash
# Import Furry Stashes IGNs onto the Hypixel watch list via local web API.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export LIST_PATH="$ROOT/packages/db/data/furry-stashes-watchlist-2026-07-13.json"
export BASE_URL="${PITANTIR_URL:-http://localhost:3000}"

if [[ ! -f "$LIST_PATH" ]]; then
  echo "Missing $LIST_PATH"
  exit 1
fi

if ! curl -sf -m 3 "$BASE_URL/api/accounts" >/dev/null; then
  echo "Web app not reachable at $BASE_URL"
  echo "Start it first: npx pnpm@10.11.0 restart:web"
  exit 1
fi

echo "Importing watch list from $LIST_PATH → $BASE_URL"
python3 - <<'PY'
import json, os, urllib.request, urllib.error, time
from pathlib import Path

base = os.environ["BASE_URL"].rstrip("/")
names = json.loads(Path(os.environ["LIST_PATH"]).read_text())["usernames"]
ok = created = promoted = already = failed = 0
failures = []

for i, name in enumerate(names, 1):
    req = urllib.request.Request(
        f"{base}/api/accounts",
        data=json.dumps({"mcUsername": name, "watchlisted": True, "enabled": True}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode())
        ok += 1
        if body.get("created"):
            created += 1
            mark = "created"
        elif body.get("promoted"):
            promoted += 1
            mark = "promoted"
        else:
            already += 1
            mark = "already"
        print(f"[{i}/{len(names)}] {name}: {mark}")
    except urllib.error.HTTPError as e:
        failed += 1
        err = e.read().decode(errors="replace")
        failures.append((name, err))
        print(f"[{i}/{len(names)}] {name}: FAIL {err[:160]}")
    except Exception as e:
        failed += 1
        failures.append((name, str(e)))
        print(f"[{i}/{len(names)}] {name}: FAIL {e}")
    time.sleep(0.05)

print()
print(f"Done. ok={ok} created={created} promoted={promoted} already={already} failed={failed}")
if failures:
    print("Failures:")
    for name, err in failures:
        print(f"  - {name}: {err[:200]}")
PY
