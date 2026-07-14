#!/usr/bin/env bash
# Bring up local Postgres + env files for Pitantir (macOS / Linux).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for local Postgres. Install Docker Desktop, then re-run."
  exit 1
fi

echo "→ Starting Postgres (docker compose)…"
docker compose up -d

ENV_FILE="$ROOT/.env"
WEB_ENV="$ROOT/apps/web/.env.local"
DB_URL="postgresql://pitantir:pitantir@localhost:5432/pitantir"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT/.env.example" "$ENV_FILE"
  echo "Created $ENV_FILE"
fi

if [[ ! -f "$WEB_ENV" ]]; then
  cp "$ROOT/apps/web/.env.example" "$WEB_ENV"
  echo "Created $WEB_ENV — add PITPANDA_API_KEY there (or via /settings)."
fi

# Ensure DATABASE_URL is present
if ! grep -q '^DATABASE_URL=' "$WEB_ENV" 2>/dev/null; then
  echo "DATABASE_URL=$DB_URL" >> "$WEB_ENV"
fi

echo "→ Waiting for Postgres…"
for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U pitantir -d pitantir >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "→ Running migrations…"
npx pnpm@10.11.0 db:migrate

echo "→ Clearing Next.js cache…"
rm -rf "$ROOT/apps/web/.next"

echo
echo "Ready. In two terminals:"
echo "  1) npx pnpm@10.11.0 --filter @pitantir/web dev"
echo "  2) npx pnpm@10.11.0 start:worker   # optional until you scan"
echo
echo "Then cache accounts (example):"
echo "  curl -sS -X POST http://localhost:3000/api/accounts/cache-ownership \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"usernames\":[\"Scry\",\"Grizloy\",\"Skunker\",\"MangleFoxyX3\",\"duck996\"]}'"
