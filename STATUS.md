# Pitantir — Implementation Status

Last updated: 2026-07-13

## Current phase

Phase 1 — Database foundation + operator accounts UI

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

## Next task

**T13 — DB job claim/lease loop** (scanner worker foundation)

Then T14–T18 scanning pipeline.

## Validation (latest)

```bash
pnpm typecheck   # pass
pnpm lint        # pass
pnpm test        # 34 tests pass
pnpm build:web   # pass (/search, /accounts, APIs)
pnpm db:migrate  # 0000 + 0001 applied
```

## Notes

- With `DATABASE_URL` in `apps/web/.env.local`, identity + observations persist in Postgres; without it, memory store is used.
- Accounts require Postgres (`/accounts` shows a clear error if `DATABASE_URL` is missing).
- Scanner worker is not built yet — accounts are managed but not scanned.
- Set `PITPANDA_API_KEY` via Item Search form or env; never expose the key in responses.
