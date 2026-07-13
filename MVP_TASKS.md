# Pitantir — MVP Task Breakdown

Ordered tasks. Each task should be independently completable and testable. Later tasks assume earlier ones are merged.

Mark of done for each task: code + automated test (or migration verification) + short note in PR.

---

## Phase 0 — Repository skeleton

### T00 — Monorepo bootstrap ✅
- Create pnpm/npm workspaces: `apps/web`, `apps/worker`, `packages/shared`, `packages/db`
- TypeScript strict base config
- Root scripts: `lint`, `test`, `typecheck`
- **Test:** `pnpm typecheck` passes on empty packages
- **Done:** 2026-07-13 — pnpm workspaces, strict `tsconfig.base.json`, ESLint + Vitest root scripts

### T01 — Documentation gate
- Ensure root docs (`SPEC.md`, etc.) remain the source of truth
- Add README pointer to docs (extend existing README minimally)
- **Test:** files exist; links in README resolve

---

## Phase 1 — Database foundation

### T02 — Postgres + Drizzle setup ✅
- Docker Compose Postgres
- Drizzle config + migration runner
- **Test:** migrate up on fresh DB
- **Done:** 2026-07-13 — `docker-compose.yml`, `drizzle.config.ts`, `0000_init_identity` migration, `pnpm db:migrate`

### T03 — Core enums & `admin_settings` ✅
- Create enums for scan/resolution/location/identity
- `admin_settings` table with defaults (scan interval, thresholds)
- **Test:** seed defaults; read round-trip
- **Done:** 2026-07-13 — `admin_settings` migration + `seedAdminSettings`

### T04 — `accounts` table + soft delete ✅
- Schema per `DATA_MODEL.md`
- Unique username constraint among active rows
- **Test:** soft-deleted username can be re-added; enabled filter works
- **Done:** 2026-07-13 — accounts migration, repository, `/accounts` UI + API

### T05 — `canonical_items` + `item_identifiers` ✅
- Schema per `DATA_MODEL.md`
- Non-unique nonce indexes
- External ref unique `(kind, source, value)` for active rows
- **Test:** two items can share same nonce identifier values
- **Done:** 2026-07-13 — Drizzle schema + `MemoryIdentityStore` with non-unique nonce support

### T06 — `scans`, `observations`, `observation_candidates` ✅ (identity scope)
- Unique `(scan_id, slot_key)`
- Observation immutability for raw fields
- **Test:** duplicate observation insert fails; ambiguous candidates persisted
- **Done:** 2026-07-13 — in-memory observations + candidates (scan table deferred)

### T07 — Location tables ✅ (identity scope)
- `item_location_periods` in memory store + Drizzle schema
- **Test:** presence periods created on resolve; supersede on split
- **Done:** 2026-07-13 — basic period tracking for identity operations

### T09 — `identity_decisions` + `jobs` ✅ (identity scope)
- Audit schema + idempotent decision keys
- **Test:** merge/split/revert append audit rows
- **Done:** 2026-07-13 — `identity_decisions` in memory + Drizzle (jobs deferred)

---

## Phase 2 — Shared domain logic

### T10 — Normalization + fingerprints ✅
- Implement normalize + strict/loose fingerprint in `packages/shared`
- Version prefix support
- **Test:** stable hashes; volatile fields excluded; unicode normalization cases
- **Done:** 2026-07-13

### T11 — Zod schemas ✅ (identity scope)
- Resolution / merge / split / revert input schemas
- **Test:** valid/invalid fixtures via service calls
- **Done:** 2026-07-13

### T12 — Candidate scoring pure functions ✅
- Score + reasons JSON
- Clone-family ambiguity detection
- **Test:** ambiguous twin-nonce case in identity suite
- **Done:** 2026-07-13

---

## Phase 3 — Job runner (worker shell)

### T13 — DB job claim/lease loop ✅
- Claim pending jobs with `FOR UPDATE SKIP LOCKED`
- Heartbeat / expire leases
- **Test:** two workers don’t claim same job; expired lease reclaimed
- **Done:** 2026-07-13 — `jobs` migration, `JobsRepository`, worker `WorkerLoop`

### T14 — Scheduler tick ✅
- Enqueue `scan_account` for due enabled accounts
- Stable schedule idempotency keys
- **Test:** no duplicate enqueue for same slot; disabled accounts skipped
- **Done:** 2026-07-13 — `ScanScheduler` + worker runtime loop

---

## Phase 4 — Scanning pipeline

### T15 — Inventory source adapter interface ✅
- Define port/adapter for fetching account inventory
- Provide **mock adapter** for tests
- **Test:** mock returns fixture inventories
- **Done:** 2026-07-13 — `packages/shared/src/inventory`

### T16 — `scan_account` job handler ✅
- Create scan row, fetch, success/failure persistence
- **Test:** failure leaves no observations; success stores hash + raw JSON
- **Done:** 2026-07-13 — `scans` migration + `ScanAccountHandler`

### T17 — Observation extraction + upsert ✅
- Slot keys, metadata, fingerprints
- **Test:** reprocess same scan ⇒ same row count / same natural keys
- **Done:** 2026-07-13 — `extractBookSlots` + upsert via IdentityService

### T18 — `process_scan` orchestration ✅
- Extract → resolve stub → location stub
- Mark processing status
- **Test:** end-to-end on mock success scan
- **Done:** 2026-07-13 — `ProcessScanHandler` + worker wiring + Scan now API

---

## Phase 5 — Identity resolution (MVP)

### T19 — Auto-resolve unique nonce ✅
- Novel nonce creates item when setting enabled
- Unique existing nonce resolves
- **Test:** idempotent auto-resolve + novel nonce create
- **Done:** 2026-07-13

### T20 — Ambiguity on colliding nonce ✅
- Second item with same nonce+fingerprint does not auto-steal
- Candidates persisted; status `ambiguous`
- **Test:** `ITEM_IDENTITY.md` identical metadata+nonce case
- **Done:** 2026-07-13

### T21 — Multiplicity matching on one account
- Two expected clones + two observations → both resolve
- Two expected + one observation → one disappearance path later
- **Test:** multiset matching unit + integration

### T22 — Manual resolve API ✅
- Assign / create item / leave unresolved
- Writes `identity_decisions`; sets `manually_resolved`
- **Test:** manual revert restores prior state
- **Done:** 2026-07-13

### T23 — Merge items ✅
- Transactional merge + audit snapshots
- **Test:** identifiers move; loser `merged_away`; history preserved
- **Done:** 2026-07-13

### T24 — Split item ✅
- Create new item; reassign observation subset; rebuild periods
- **Test:** nonce identifier may exist on both resulting items
- **Done:** 2026-07-13

---

## Phase 6 — Location engine

### T25 — Presence open/close from resolved observations
- Implement §6.1–6.2 of `SCANNING_RULES.md`
- **Test:** failed scan no close; successful empty closes to unknown gap

### T26 — Confirmed vs uncertain moves
- Implement move_confirmed gates + move_uncertain
- **Test:** absence+presence same item ⇒ one confirmed event; clone ambiguity ⇒ uncertain/no confirm

### T27 — Event idempotency
- Reprocess scan emits no duplicate location events
- **Test:** process twice, event count unchanged

### T28 — Contradiction handling
- Mark periods contradicted; keep evidence
- **Test:** dual-account open presence for non-clone flags contradiction

---

## Phase 7 — Web app: foundations

### T29 — Next.js app shell + auth gate
- Minimal operator auth (env credentials / session)
- Layout navigation for required pages
- **Test:** unauthenticated redirect

### T30 — Admin settings page
- Edit default interval, auto-create flags, thresholds
- **Test:** settings persist

### T31 — Accounts list + CRUD ✅
- Add/edit/disable/soft-delete; never expose secrets
- **Test:** disable stops eligibility query
- **Done:** 2026-07-13 — `/accounts` + API (eligibility via enabled filter in scheduler)

### T32 — Account detail history ✅
- Scans list, currently held resolved items, failures
- **Test:** render with fixtures (component or integration)
- **Done:** 2026-07-13 — `/accounts/[id]` + `AccountHistoryService`

---

## Phase 8 — Web app: items & scans

### T33 — Items list ✅
- Filters: confidence, category, location known/unknown, nonce search
- **Test:** query filters
- **Done:** 2026-07-13 — `/items` + `CatalogRepository.listItems`

### T34 — Item detail page ✅
- Identifiers, current location, timeline with gaps, provenance, observations, overlapping books (basic query)
- **Test:** unknown gap visible; import vs scan provenance labels
- **Done:** 2026-07-13 — `/items/[id]` (timeline + observations; overlap deferred)

### T35 — Scan history page ✅
- Success/failure distinction; link into scan detail/observations
- **Test:** failure row shows error, not empty inventory
- **Done:** 2026-07-13 — `/scans` global list

---

## Phase 9 — Resolution & import UIs

### T36 — Unresolved observations queue
- List unresolved/ambiguous/probable
- **Test:** ordering and filters

### T37 — Manual identity-resolution workspace
- Candidate comparison, assign/create, clone-family warnings when nonce collisions exist
- **Test:** completing resolve updates observation + decision audit

### T38 — Import upload + batch list
- JSON/JSONL parse; create batch/claims
- **Test:** duplicate file hash rejected; invalid claims reported

### T39 — Import review UI
- Accept/reject/link; show provenance
- **Test:** accept creates external_ref; reject no item change

---

## Phase 10 — Overlap (MVP slice) + polish

### T40 — Overlap explorer v1
- Given item A, list items sharing any account historically
- Show count of shared accounts; simple overlapping interval list for selected pair
- **Test:** SQL/integration against period fixtures

### T41 — Seed script + demo fixtures
- Accounts, colliding nonce pair, nonce-less import, scan success/failure
- **Test:** demo script runs against Compose DB

### T42 — Playwright smoke
- Login → accounts → items → unresolved → imports pages load
- **Test:** CI-capable smoke

---

## Phase 11 — Hardening before “MVP done”

### T43 — False-movement regression pack
- Codify checklist tests from `SCANNING_RULES.md` §13
- **Test:** full pack green

### T44 — Identical nonce+metadata twin pack
- Explicit regression suite for two distinct items with identical evidence
- Include: simultaneous presence on two accounts; sequential uncertain move; multiplicity on one account
- **Test:** pack green; documented in `ITEM_IDENTITY.md` reference

### T45 — Operational README
- How to run web, worker, migrate, seed, test
- **Test:** instructions validated once in clean environment

---

## Deferred (explicitly not MVP)

- Full bipartite graph visualization / shortest-path UI
- Hot-account leaderboard beyond simple SQL page
- Redis/BullMQ
- Multi-operator RBAC
- Live external sync connectors
- Automatic re-fingerprint migrations UI
- Public read-only site
- Shulker-tree extraction edge cases beyond basic slot_key support (expand after adapter reality known)

---

## Suggested implementation order summary

```text
T00–T09  schema
T10–T12  shared logic
T13–T18  scan pipeline
T19–T24  identity
T25–T28  location
T29–T39  UI
T40–T45  overlap slice + hardening
```

Each vertical slice after T18 can ship behind incomplete UI using repository-level tests until pages land.
