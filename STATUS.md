# Pitantir — Implementation Status

Last updated: 2026-07-13

## Current phase

Phase 4 — Scanning pipeline (mock inventory) complete

## Completed tasks

| Task | Summary | Date |
|---|---|---|
| T00–T14 | Monorepo, identity, accounts, job claim/lease, scheduler | 2026-07-13 |
| — | PitPanda search UI + Postgres identity | 2026-07-13 |
| **T15** | Inventory source port + `MockInventorySource` | 2026-07-13 |
| **T16** | `scans` table + `scan_account` handler | 2026-07-13 |
| **T17** | Observation extract/upsert from raw inventory | 2026-07-13 |
| **T18** | `process_scan` (extract → auto-resolve → presence stub) | 2026-07-13 |

## Next task

**T21 / T25+** — multiplicity matching and full location transitions, then item/scan UIs.

## Validation (latest)

```bash
pnpm typecheck   # pass
pnpm lint        # pass
pnpm test        # 45 tests pass
pnpm db:migrate  # through 0003_scans
```

## How to try it locally

1. Postgres up (`docker compose up -d`)
2. `pnpm db:migrate`
3. `pnpm dev` + `pnpm start:worker` (`INVENTORY_SOURCE=mock` default)
4. `/accounts` → **Scan now** on an account
5. Worker logs `scan_account completed` / `process_scan completed` with observation counts

Live Minecraft inventory adapters are not wired yet — mock returns synthetic books per account.
