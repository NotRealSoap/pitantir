#!/usr/bin/env bash
# Safe Next.js restart — kills old servers BEFORE touching .next
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ Stopping any Next.js processes…"
pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
pkill -f "node.*apps/web" 2>/dev/null || true
sleep 1

# Free port 3000 if something is still bound
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti tcp:3000 2>/dev/null || true)"
  if [[ -n "${PIDS}" ]]; then
    echo "→ Killing leftover listeners on :3000 → ${PIDS}"
    # shellcheck disable=SC2086
    kill ${PIDS} 2>/dev/null || true
    sleep 1
  fi
fi

echo "→ Clearing stale Next cache…"
rm -rf "$ROOT/apps/web/.next" "$ROOT/apps/web/node_modules/.cache" "$ROOT/node_modules/.cache"

echo "→ Starting web on http://localhost:3000"
echo "   Wait until you see Ready — then open /accounts in a NEW tab."
exec npx pnpm@10.11.0 --filter @pitantir/web dev
