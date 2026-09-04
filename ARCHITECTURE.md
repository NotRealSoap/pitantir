# Pitantir — Architecture

## 1. Overview

Pitantir is a TypeScript monorepo with three runtime surfaces and one shared library:

```
┌─────────────────────────────────────────────────────────────┐
│                        Operators (browser)                   │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTPS
┌────────────────────────────▼────────────────────────────────┐
│  Next.js Web App (UI + API routes / server actions)          │
│  - Account / item / scan / import / resolution UIs           │
│  - Auth-gated admin                                        │
│  - Reads/writes PostgreSQL via ORM                         │
│  - Enqueues scan / import / resolution jobs                │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
                │ SQL                         │ Queue messages
┌───────────────▼───────────────┐   ┌─────────▼────────────────┐
│  PostgreSQL                   │   │  Job queue               │
│  - Canonical state            │   │  (DB-backed MVP)         │
│  - Observations & audits      │   └─────────┬────────────────┘
└───────────────▲───────────────┘             │
                │ SQL                         │
┌───────────────┴─────────────────────────────▼───────────────┐
│  Scanner / Worker process (separate from web requests)       │
│  - Poll / claim jobs                                         │
│  - Fetch Minecraft account inventories                       │
│  - Persist scans + raw observations                          │
│  - Run identity resolution & location update pipelines       │
│  - Process imports                                           │
└─────────────────────────────────────────────────────────────┘
```

The scanner **must not** run inside Next.js request handlers. Website availability must not depend on Minecraft API latency.

## 2. Technology choices

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | Shared types across web + worker |
| Web | Next.js (App Router) | UI + thin API / server actions |
| Database | PostgreSQL | Temporal ranges, JSONB, uniqueness constraints |
| ORM | **Drizzle** | Preferred for explicit SQL, composite unique indexes, and temporal queries; Prisma acceptable if team standardizes on it |
| Validation | Zod | Shared schemas for API, imports, job payloads |
| Monorepo | npm/pnpm workspaces | `apps/web`, `apps/worker`, `packages/shared`, `packages/db` |
| Jobs (MVP) | PostgreSQL job table + worker poller | No Redis/BullMQ required for MVP |
| Auth (MVP) | Single-operator / env-configured session or basic auth | Defer multi-user RBAC |
| Tests | Vitest + Playwright (smoke) | Unit tests for identity/location; integration tests with Postgres |
| Packaging | Docker Compose for local Postgres (+ optional worker) | Keep infra minimal |

### Why Drizzle over Prisma (recommendation)

- Easier expression of partial unique indexes and exclusion constraints later
- Cleaner raw SQL for overlap queries (`tstzrange`, `OVERLAPS`)
- Migrations remain explicit SQL-friendly

If Prisma is chosen instead, the logical model in `DATA_MODEL.md` still applies; map carefully around JSON fields and unique constraints.

## 3. Package layout

```
/
├── apps/
│   ├── web/                 # Next.js site
│   └── worker/              # Scanner + job processors
├── packages/
│   ├── shared/              # Types, Zod schemas, fingerprinting, identity helpers
│   └── db/                  # Drizzle schema, migrations, repositories
├── SPEC.md
├── ARCHITECTURE.md
├── DATA_MODEL.md
├── ITEM_IDENTITY.md
├── SCANNING_RULES.md
├── IMPORT_FORMAT.md
├── MVP_TASKS.md
└── CLAUDE.md
```

## 4. Component responsibilities

### 4.1 Web app (`apps/web`)

- Render all required pages
- CRUD for accounts and admin settings
- Trigger “scan now”, import upload, and identity actions by inserting jobs
- Never call Minecraft inventory APIs directly in request path
- Serve read models: items, accounts, scans, unresolved queue, overlap summaries

### 4.2 Worker (`apps/worker`)

Job types (MVP):

| Job | Purpose |
|---|---|
| `scan_account` | Fetch inventory for one account; write scan + observations |
| `process_scan` | Idempotent observation upsert + resolution attempt + location update |
| `resolve_observation` | Re-run or apply manual resolution |
| `import_batch` | Parse and stage external claims |
| `apply_identity_decision` | Merge / split / manual link with audit |

Worker rules:

- At-most-one active scan per account (enforced by unique active job / advisory lock)
- Configurable concurrency across accounts
- Exponential backoff on transient Minecraft API failures
- Heartbeats / lease timeouts so crashed workers release jobs

### 4.3 Shared (`packages/shared`)

- Item metadata normalization
- Strict and loose fingerprint computation
- Resolution status enums and confidence scoring interfaces
- Import payload schemas
- Pure functions for candidate ranking (unit-tested heavily)

### 4.4 Database package (`packages/db`)

- Schema + migrations
- Repository functions used by web and worker
- Transaction helpers for identity merge/split and scan processing

## 5. Data flow

### 5.1 Happy-path scan

1. Scheduler inserts `scan_account` jobs for due enabled accounts.  
2. Worker claims job, creates `scans` row (`status=running`).  
3. Worker fetches inventory.  
4. On success: store raw payload hash, write observations (idempotent), mark scan `success`, enqueue `process_scan` if not inline.  
5. Processor attempts identity resolution per observation.  
6. For resolved observations, update location periods per `SCANNING_RULES.md`.  
7. Unresolved / ambiguous observations appear in review queues.

### 5.2 Failure path

1. Fetch fails or times out.  
2. Scan marked `failure` with error class and message.  
3. **No** inventory snapshot written as empty.  
4. **No** location periods closed.  
5. Account remains eligible for retry per backoff policy.

### 5.3 Manual identity resolution

1. Operator opens unresolved workspace.  
2. Selects observation + candidate item(s), or creates new canonical item.  
3. Web inserts `apply_identity_decision` job (or executes in a short DB transaction from server action if synchronous is preferred for UX).  
4. Decision written to `identity_decisions` audit table.  
5. Observation linkage and location implications recomputed.

## 6. Scheduling (MVP)

Use a DB-backed scheduler inside the worker:

- Table `accounts` has `next_scan_at`, `scan_interval_seconds`, `priority`
- Worker loop: select due accounts → enqueue jobs → process
- Optional: cron-like `tick` every N seconds

**Deferred:** Redis, BullMQ, Temporal, Kubernetes CronJobs, multi-region scanners.

## 7. Secrets & configuration

Environment variables (illustrative):

- `DATABASE_URL`
- `AUTH_SECRET` / operator credentials
- Minecraft API credentials / session tokens as required by chosen inventory source
- `SCAN_DEFAULT_INTERVAL_SECONDS`
- `WORKER_CONCURRENCY`

Secrets stored encrypted at rest when associated with accounts (`accounts.credentials_encrypted`). Never return decrypted secrets to the client.

## 8. Observability (MVP-minimal)

- Structured logs (JSON) from web + worker
- Persist scan failures with categorized error codes
- Admin page for recent failures
- **Deferred:** OpenTelemetry, Prometheus, distributed tracing

## 9. Security (MVP)

- Admin routes gated
- CSRF protection via Next.js patterns
- Parameterized SQL only
- Rate-limit destructive admin actions lightly
- Soft-delete for accounts/items; hard delete rare and audited

## 10. Testing strategy

| Layer | Focus |
|---|---|
| Unit | Fingerprints, candidate ranking, merge/split pure logic, location transition rules |
| Integration | Scan idempotency, observation uniqueness, location period updates against Postgres |
| UI smoke | Critical pages render with fixtures |
| Fixtures | Colliding nonces, identical metadata duplicates, nonce-less imports, scan failures |

## 11. MVP vs deferred infrastructure

### Include in MVP

- Next.js app + separate worker process
- PostgreSQL
- Drizzle (or Prisma) + migrations
- DB job queue / poller
- Shared Zod types
- Docker Compose for Postgres
- Vitest integration tests

### Defer

- Redis / BullMQ / Temporal
- Message buses
- Object storage for large raw payloads (store JSONB first; extract later if needed)
- Multi-worker leader election beyond DB locks
- CDN / complex caching layers
- Full bipartite graph visualization library (store data; simple tables first)
- Public API for third parties

## 12. Deployment shape (suggested)

Single VPS or container host:

- `web` service (Next.js)
- `worker` service (long-running Node process)
- managed or local PostgreSQL

Practical ~$5/mo path: [DEPLOY.md](./DEPLOY.md) + `docker-compose.prod.yml`.

Horizontal scale later by adding workers with row-level job claiming.

## 13. Extension points for overlap analysis

Location periods are stored as first-class temporal intervals with account FKs. Overlap features query:

```text
item_location_periods ⋈ item_location_periods
  ON account_id equal AND time ranges overlap AND item_id different
```

No separate “movement graph” table is required in MVP; derived views or materialized views can be added later without changing observation/identity cores.
