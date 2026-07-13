# Pitantir — Implementation Status

Last updated: 2026-07-13

## Current phase

Phase 1 — Database foundation (in progress)

## Completed tasks

| Task | Summary | Date |
|---|---|---|
| T00 | Monorepo bootstrap | 2026-07-13 |
| T01 | Documentation gate | 2026-07-13 |
| T02 | Postgres + Drizzle setup (Compose, migrations, migrate runner) | 2026-07-13 |
| T05 | `canonical_items` + `item_identifiers` (schema + memory store) | 2026-07-13 |
| T06 | Observations + candidates (identity scope, in-memory) | 2026-07-13 |
| T07 | Location periods (identity scope, in-memory) | 2026-07-13 |
| T09 | `identity_decisions` audit (identity scope, in-memory) | 2026-07-13 |
| T10 | Fingerprints + normalization | 2026-07-13 |
| T11 | Zod schemas (identity inputs) | 2026-07-13 |
| T12 | Candidate scoring + auto-resolver | 2026-07-13 |
| T19 | Auto-resolve unique nonce | 2026-07-13 |
| T20 | Ambiguity on colliding nonce | 2026-07-13 |
| T22 | Manual resolve API | 2026-07-13 |
| T23 | Merge items | 2026-07-13 |
| T24 | Split item | 2026-07-13 |

## Next task

**T03 — Core enums & `admin_settings`**

Then **T21** — multiplicity matching on one account.

## Validation (latest)

```bash
pnpm typecheck   # pass
pnpm lint        # pass
pnpm test        # 18 tests pass (includes migration test on pitantir_test)
pnpm db:migrate  # applies migrations/0000_init_identity.sql
```

## Notes

- Identity resolution uses `MemoryIdentityStore`; Drizzle schema is migrated to PostgreSQL but not yet wired as a repository.
- Local dev: `docker compose up -d` or system Postgres with `.env` from `.env.example`.
- Migration test uses `pitantir_test` database; drops `public` and `drizzle` schemas before each run.
