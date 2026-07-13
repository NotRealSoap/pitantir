# Pitantir — Implementation Status

Last updated: 2026-07-13

## Current phase

Phase 3–4 — Job runner complete; scanning pipeline next

## Completed tasks

| Task | Summary | Date |
|---|---|---|
| T00 | Monorepo bootstrap | 2026-07-13 |
| T01 | Documentation gate | 2026-07-13 |
| T02 | Postgres + Drizzle setup | 2026-07-13 |
| T03 | `admin_settings` + seed defaults | 2026-07-13 |
| T04 | `accounts` table + soft delete + Accounts UI/API | 2026-07-13 |
| T05–T07, T09 | Identity schema + memory store | 2026-07-13 |
| T10–T12, T19–T20, T22–T24 | Identity domain logic | 2026-07-13 |
| — | **PostgresIdentityStore** wired into web when `DATABASE_URL` is set | 2026-07-13 |
| — | PitPanda search UI + key setup form | 2026-07-13 |
| **T13** | DB job claim/lease (`FOR UPDATE SKIP LOCKED`, heartbeat, reclaim) | 2026-07-13 |
| **T14** | Scheduler tick for due `scan_account` jobs | 2026-07-13 |

## Next task

**T15 — Inventory source adapter** (mock + real later)

Then T16–T18 scan persistence / observation extract / `process_scan`.

## Validation (latest)

```bash
pnpm typecheck   # pass
pnpm lint        # pass
pnpm test        # 39 tests pass
pnpm db:migrate  # 0000 + 0001 + 0002 applied
```

## Notes

- Worker: `pnpm start:worker` (requires `DATABASE_URL`). Schedule tick + claim loop run; `scan_account` / `process_scan` handlers are stubs until T16–T18.
- Jobs use unique `idempotency_key`; schedule keys are `scan_account:{accountId}:{nextScanAtISO}`.
- With `DATABASE_URL` in `apps/web/.env.local`, identity + observations persist in Postgres; without it, memory store is used.
- Accounts require Postgres (`/accounts` shows a clear error if `DATABASE_URL` is missing).
- Set `PITPANDA_API_KEY` via Item Search form or env; never expose the key in responses.
