# Pitantir — Implementation Status

Last updated: 2026-07-13

## Current phase

Phase 2 / Phase 5 — Shared domain logic + identity resolution (in-memory)

## Completed tasks

| Task | Summary | Date |
|---|---|---|
| T00 | Monorepo bootstrap | 2026-07-13 |
| T01 | Documentation gate | 2026-07-13 |
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

**T02 — Postgres + Drizzle setup** (wire Drizzle repository to PostgreSQL; migrations)

Then **T21** — multiplicity matching on one account.

## Validation (latest)

```bash
pnpm typecheck   # pass
pnpm lint        # pass
pnpm test        # 17 tests pass
```

## Notes

- Identity resolution is implemented via `IdentityService` + `MemoryIdentityStore` with full audit trail support.
- Drizzle schema for identity tables exists in `packages/db/src/schema/identity.ts` but is not yet migrated to PostgreSQL.
- Location period rebuild on split is basic (supersede + per-observation presence); full location engine remains in Phase 6.
- Multiset clone matching (T21) is not yet implemented.
