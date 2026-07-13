# Pitantir — Data Model

## 1. Design principles

1. **Internal UUIDs only as PKs** for application entities (especially canonical items).  
2. **Evidence is not identity** — nonces, fingerprints, and external IDs live in satellite tables.  
3. **Append-friendly history** — observations and audits are immutable; location periods are closed, not silently rewritten (except controlled corrections with audit).  
4. **Idempotent scans** — unique constraints prevent duplicate observations/movements.  
5. **Schema-ready for overlap** — presence is stored as temporal intervals per `(item, account)`.  
6. **Soft delete by default** for operator-facing entities.

All primary keys are `uuid` unless noted. Timestamps are `timestamptz`.

---

## 2. Entity overview

```
accounts ──< scans ──< observations >── canonical_items
                │              │                │
                │              ├── observation_candidates
                │              │
                │              └── (resolution fields)
                │
canonical_items ──< item_identifiers
canonical_items ──< item_location_periods >── accounts
canonical_items ──< identity_decisions
external_sources ──< import_batches ──< import_claims >── canonical_items?
jobs
admin_settings
```

---

## 3. Entities

### 3.1 `accounts`

Tracked Minecraft accounts.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | Internal |
| `mc_uuid` | uuid NULL | Mojang UUID when known |
| `mc_username` | text NOT NULL | Display / lookup name |
| `display_name` | text NULL | Operator label |
| `enabled` | boolean NOT NULL DEFAULT true | Disabled ⇒ no new scans |
| `priority` | int NOT NULL DEFAULT 100 | Lower = sooner |
| `scan_interval_seconds` | int NOT NULL | Override default |
| `next_scan_at` | timestamptz NOT NULL | Scheduler cursor |
| `last_success_scan_at` | timestamptz NULL | |
| `last_failure_scan_at` | timestamptz NULL | |
| `credentials_encrypted` | text NULL | Secret blob |
| `notes` | text NULL | |
| `created_at` | timestamptz NOT NULL | |
| `updated_at` | timestamptz NOT NULL | |
| `deleted_at` | timestamptz NULL | Soft delete |

**Indexes / constraints**

- Unique `(mc_uuid)` WHERE `mc_uuid IS NOT NULL AND deleted_at IS NULL`
- Unique `(lower(mc_username))` WHERE `deleted_at IS NULL` (or allow rename history via separate table later)
- Index `(enabled, next_scan_at)` WHERE `deleted_at IS NULL`

**Deletion:** soft delete. Existing scans/observations/location periods retained. Hard delete forbidden while referencing history exists (or cascade-blocked).

---

### 3.2 `scans`

One attempt to inventory an account.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `account_id` | uuid FK → accounts | |
| `status` | enum | `queued`, `running`, `success`, `failure`, `cancelled` |
| `triggered_by` | enum | `schedule`, `manual`, `retry` |
| `idempotency_key` | text NOT NULL | Stable key for this attempt |
| `started_at` | timestamptz NULL | |
| `finished_at` | timestamptz NULL | |
| `observed_at` | timestamptz NULL | Logical inventory time (usually fetch completion) |
| `error_code` | text NULL | |
| `error_message` | text NULL | |
| `raw_inventory_hash` | text NULL | SHA-256 of normalized raw payload |
| `raw_inventory` | jsonb NULL | Full successful payload only |
| `item_count` | int NULL | Count of book-like items on success |
| `processing_status` | enum | `pending`, `processed`, `failed`, `skipped` |
| `processed_at` | timestamptz NULL | |
| `created_at` | timestamptz NOT NULL | |

**Indexes / constraints**

- Unique `(idempotency_key)`
- Unique `(account_id, observed_at, raw_inventory_hash)` WHERE `status = 'success' AND raw_inventory_hash IS NOT NULL` — optional hardening against duplicate success rows
- Index `(account_id, created_at DESC)`
- Index `(status, processing_status)`

**Deletion:** retain indefinitely (audit). No cascade delete of observations in MVP; admin purge is a deferred, explicit tool.

**Rule:** `status = failure` ⇒ `raw_inventory` NULL, `item_count` NULL. Never store an empty inventory for failures.

---

### 3.3 `canonical_items`

Permanent internal identity for a distinct book instance.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | **Only** PK; app-generated |
| `display_name` | text NULL | Operator-facing label |
| `category` | enum | `unique_nonce_candidate`, `duplicate_nonce`, `nonce_less`, `unknown` |
| `identity_confidence` | enum | `high`, `medium`, `low`, `contested` |
| `primary_nonce` | text NULL | Convenience denormalized evidence; **not unique** |
| `strict_fingerprint` | text NULL | Latest known / representative |
| `loose_fingerprint` | text NULL | |
| `status` | enum | `active`, `merged_away`, `split_source`, `archived` |
| `merged_into_item_id` | uuid NULL FK → canonical_items | When merged away |
| `notes` | text NULL | |
| `created_at` | timestamptz NOT NULL | |
| `updated_at` | timestamptz NOT NULL | |
| `deleted_at` | timestamptz NULL | Soft archive |

**Indexes / constraints**

- Index `(primary_nonce)` — **non-unique**
- Index `(strict_fingerprint)` — **non-unique**
- Index `(status)` WHERE `deleted_at IS NULL`
- Check: if `status = 'merged_away'` then `merged_into_item_id IS NOT NULL`

**Deletion:** soft. Prefer `status` transitions (`merged_away`, `archived`) over hard delete.

---

### 3.4 `item_identifiers`

All known identifiers for a canonical item (1 item → many identifiers; 1 nonce value → many items).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `item_id` | uuid FK → canonical_items | |
| `kind` | enum | `nonce`, `strict_fingerprint`, `loose_fingerprint`, `external_ref`, `manual_tag`, `legacy_id` |
| `source` | text NULL | Required for `external_ref` (namespace) |
| `value` | text NOT NULL | |
| `is_preferred` | boolean NOT NULL DEFAULT false | |
| `confidence` | enum | `high`, `medium`, `low` |
| `first_seen_at` | timestamptz NULL | |
| `last_seen_at` | timestamptz NULL | |
| `created_at` | timestamptz NOT NULL | |
| `invalidated_at` | timestamptz NULL | Soft remove identifier |

**Indexes / constraints**

- Unique `(kind, source, value, item_id)` WHERE `invalidated_at IS NULL` — same identifier may attach once per item
- Index `(kind, value)` — find candidate items by nonce/fingerprint (**non-unique**)
- Unique `(kind, source, value)` WHERE `kind = 'external_ref' AND invalidated_at IS NULL` — one external ref maps to at most one item unless invalidated; linking changes go through identity decisions
- **No** unique constraint on `(kind='nonce', value)` alone

---

### 3.5 `observations`

Raw book sightings from successful scans. Stored before (and independently of) confident assignment.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `scan_id` | uuid FK → scans | |
| `account_id` | uuid FK → accounts | Denormalized for query ease |
| `observed_at` | timestamptz NOT NULL | Copied from scan logical time |
| `slot_key` | text NOT NULL | Stable within-scan position key (inventory slot / path) |
| `raw_item` | jsonb NOT NULL | Original item payload |
| `observed_nonce` | text NULL | Extracted if present |
| `normalized_metadata` | jsonb NOT NULL | Title, author, pages hash, generation, etc. |
| `strict_fingerprint` | text NOT NULL | |
| `loose_fingerprint` | text NOT NULL | |
| `canonical_item_id` | uuid NULL FK → canonical_items | Set when resolved |
| `resolution_status` | enum | See below |
| `confidence` | numeric(5,4) NULL | 0–1 |
| `resolution_note` | text NULL | |
| `resolved_at` | timestamptz NULL | |
| `resolved_by` | enum NULL | `auto`, `manual`, `import_link` |
| `created_at` | timestamptz NOT NULL | |

**Resolution status enum**

- `resolved`
- `probable`
- `ambiguous`
- `unresolved`
- `manually_resolved`

**Indexes / constraints**

- **Unique `(scan_id, slot_key)`** — primary idempotency for observations
- Index `(canonical_item_id, observed_at)`
- Index `(resolution_status)` WHERE `resolution_status IN ('unresolved','ambiguous','probable')`
- Index `(observed_nonce)` WHERE `observed_nonce IS NOT NULL`
- Index `(strict_fingerprint)`
- Index `(account_id, observed_at DESC)`

**Immutability:** `raw_item`, fingerprints, nonce, metadata, `scan_id`, `slot_key` are immutable. Only resolution fields may change, and changes must append `identity_decisions`.

**Deletion:** do not delete in normal operation.

---

### 3.6 `observation_candidates`

Possible canonical items for an observation before final resolution.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `observation_id` | uuid FK → observations ON DELETE CASCADE | |
| `item_id` | uuid FK → canonical_items | |
| `score` | numeric(5,4) NOT NULL | |
| `reasons` | jsonb NOT NULL | Structured match reasons |
| `created_at` | timestamptz NOT NULL | |

**Constraints**

- Unique `(observation_id, item_id)`

---

### 3.7 `item_location_periods`

Temporal presence of an item on an account (or explicit unknown gap segments).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `item_id` | uuid FK → canonical_items | |
| `account_id` | uuid NULL FK → accounts | NULL ⇒ unknown-location segment |
| `started_at` | timestamptz NOT NULL | Inclusive |
| `ended_at` | timestamptz NULL | Exclusive; NULL ⇒ open |
| `start_reason` | enum | `observed`, `import`, `manual`, `inferred_move`, `split`, `merge` |
| `end_reason` | enum NULL | `disappeared`, `moved_confirmed`, `unknown_gap`, `manual`, `merged_away`, `corrected` |
| `certainty` | enum | `confirmed`, `probable`, `uncertain`, `contradicted` |
| `is_unknown_gap` | boolean NOT NULL DEFAULT false | True when representing unknown location |
| `opening_observation_id` | uuid NULL FK → observations | |
| `closing_observation_context_scan_id` | uuid NULL FK → scans | Scan that established absence (successful) |
| `notes` | text NULL | |
| `created_at` | timestamptz NOT NULL | |
| `superseded_at` | timestamptz NULL | Soft correction |
| `superseded_by_period_id` | uuid NULL FK → self | |

**Indexes / constraints**

- Index `(item_id, started_at)`
- Index `(account_id, started_at, ended_at)` WHERE `account_id IS NOT NULL AND superseded_at IS NULL`
- Partial unique: at most one **open confirmed** presence period per item WHERE `ended_at IS NULL AND account_id IS NOT NULL AND superseded_at IS NULL AND certainty IN ('confirmed','probable')` — enforce in transaction carefully; duplicates of colliding clones may both be open on different accounts
- GiST / range index (post-MVP acceptable): `(account_id, tstzrange(started_at, coalesce(ended_at,'infinity')))` for overlap queries

**Semantics**

- Presence period: `account_id NOT NULL`, `is_unknown_gap = false`
- Unknown gap: `account_id IS NULL`, `is_unknown_gap = true`
- Do not create a presence on B solely because A ended

**Deletion:** supersede rather than delete.

---

### 3.8 `item_location_events` (optional but recommended)

Append-only event log for UI and debugging; derived from period transitions.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `item_id` | uuid FK | |
| `event_type` | enum | `seen`, `disappeared`, `unknown_started`, `move_confirmed`, `move_uncertain`, `contradiction`, `import_presence`, `manual_correction` |
| `from_account_id` | uuid NULL | |
| `to_account_id` | uuid NULL | |
| `event_time` | timestamptz NOT NULL | |
| `certainty` | enum | |
| `scan_id` | uuid NULL | |
| `observation_id` | uuid NULL | |
| `period_id` | uuid NULL | |
| `payload` | jsonb NOT NULL DEFAULT `{}` | |
| `created_at` | timestamptz NOT NULL | |

**Constraints**

- Unique `(item_id, event_type, event_time, scan_id, observation_id)` with NULLs coalesced in application idempotency key, **or** store `idempotency_key text UNIQUE`

This table prevents duplicate movement events when scans are reprocessed.

---

### 3.9 `external_sources`

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `key` | text UNIQUE | Stable namespace, e.g. `bookwiki`, `collector_sheet` |
| `name` | text NOT NULL | |
| `base_url` | text NULL | |
| `created_at` | timestamptz NOT NULL | |

---

### 3.10 `import_batches`

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `source_id` | uuid FK → external_sources | |
| `filename` | text NULL | |
| `imported_at` | timestamptz NOT NULL | |
| `imported_by` | text NULL | Operator label |
| `status` | enum | `staged`, `reviewing`, `applied`, `rejected`, `failed` |
| `raw_payload_hash` | text NOT NULL | |
| `stats` | jsonb NOT NULL DEFAULT `{}` | |
| `created_at` | timestamptz NOT NULL | |

**Constraints:** Unique `(source_id, raw_payload_hash)` to avoid duplicate batch imports.

---

### 3.11 `import_claims`

Every imported historical claim with full provenance.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `batch_id` | uuid FK → import_batches | |
| `source_id` | uuid FK → external_sources | |
| `external_item_id` | text NOT NULL | Source-specific ID |
| `original_data` | jsonb NOT NULL | Untouched |
| `normalized_claim` | jsonb NOT NULL | Mapped fields |
| `observed_nonce` | text NULL | If source provided |
| `claimed_account` | text NULL | Username / uuid string from source |
| `claimed_account_id` | uuid NULL FK → accounts | If matched |
| `claimed_seen_at` | timestamptz NULL | |
| `claimed_location_note` | text NULL | |
| `confidence` | enum | `high`, `medium`, `low`, `unknown` |
| `review_status` | enum | `pending`, `accepted`, `rejected`, `needs_info`, `linked` |
| `linked_item_id` | uuid NULL FK → canonical_items | |
| `import_date` | timestamptz NOT NULL | Usually batch time |
| `provenance` | jsonb NOT NULL | Source URL, scraper version, etc. |
| `created_at` | timestamptz NOT NULL | |
| `reviewed_at` | timestamptz NULL | |
| `review_note` | text NULL | |

**Constraints**

- Unique `(source_id, external_item_id, batch_id)` — same external ID may appear in later batches as updates; do **not** unique globally across sources
- Index `(source_id, external_item_id)`
- Index `(review_status)`

**Namespace rule:** `(source A, "128")` ≠ `(source B, "128")` unless an identity decision explicitly links them to the same `canonical_items` row (each still retained as separate `item_identifiers` of kind `external_ref` with different `source`).

---

### 3.12 `identity_decisions` (audit history)

Complete audit of identity actions.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `decision_type` | enum | `auto_resolve`, `manual_resolve`, `unlink`, `create_item`, `merge`, `split`, `invalidate_identifier`, `link_import`, `reject_import`, `correct_location` |
| `actor` | text NOT NULL | `system` or operator id |
| `observation_id` | uuid NULL | |
| `import_claim_id` | uuid NULL | |
| `from_item_ids` | uuid[] NOT NULL DEFAULT `{}` | |
| `to_item_ids` | uuid[] NOT NULL DEFAULT `{}` | |
| `before_state` | jsonb NOT NULL | Snapshot for reverse |
| `after_state` | jsonb NOT NULL | |
| `rationale` | text NULL | |
| `created_at` | timestamptz NOT NULL | |

**Indexes:** `(created_at DESC)`, GIN on `from_item_ids` / `to_item_ids` as needed.

**Deletion:** never delete; append compensating decisions.

---

### 3.13 `jobs`

DB-backed queue.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `type` | text NOT NULL | |
| `payload` | jsonb NOT NULL | |
| `status` | enum | `pending`, `leased`, `done`, `failed`, `cancelled` |
| `priority` | int NOT NULL DEFAULT 100 | |
| `run_at` | timestamptz NOT NULL | |
| `leased_by` | text NULL | |
| `lease_expires_at` | timestamptz NULL | |
| `attempts` | int NOT NULL DEFAULT 0 | |
| `last_error` | text NULL | |
| `idempotency_key` | text NULL UNIQUE | |
| `created_at` | timestamptz NOT NULL | |
| `updated_at` | timestamptz NOT NULL | |

**Indexes:** `(status, run_at, priority)` WHERE `status = 'pending'`.

---

### 3.14 `admin_settings`

| Field | Type | Notes |
|---|---|---|
| `key` | text PK | |
| `value` | jsonb NOT NULL | |
| `updated_at` | timestamptz NOT NULL | |

Examples: default scan interval, fingerprint version, feature flags.

---

## 4. Relationship summary

| From | To | Cardinality | On delete |
|---|---|---|---|
| scans.account_id | accounts | many→one | RESTRICT |
| observations.scan_id | scans | many→one | RESTRICT |
| observations.canonical_item_id | canonical_items | many→one | SET NULL |
| observation_candidates.* | observations / items | many→one | CASCADE / RESTRICT |
| item_identifiers.item_id | canonical_items | many→one | RESTRICT |
| item_location_periods.item_id | canonical_items | many→one | RESTRICT |
| item_location_periods.account_id | accounts | many→one | RESTRICT |
| import_claims.source_id | external_sources | many→one | RESTRICT |
| import_claims.linked_item_id | canonical_items | many→one | SET NULL |
| canonical_items.merged_into_item_id | canonical_items | many→one | RESTRICT |

Soft-deleted accounts/items remain referenceable by history.

---

## 5. Uniqueness & idempotency map

| Concern | Mechanism |
|---|---|
| Observation duplicate | `UNIQUE (scan_id, slot_key)` |
| Scan duplicate submit | `UNIQUE (scans.idempotency_key)` |
| Location event duplicate | `UNIQUE (item_location_events.idempotency_key)` |
| External claim in batch | `UNIQUE (source_id, external_item_id, batch_id)` |
| External ref → item | `UNIQUE (kind, source, value)` for active `external_ref` |
| Nonce → item | **No uniqueness** — collisions allowed |
| Fingerprint → item | **No uniqueness** |
| Job dedupe | `jobs.idempotency_key` UNIQUE |

---

## 6. Overlap-analysis readiness

No remodel needed for:

- Shared accounts: distinct `item_id` with periods on same `account_id`
- Temporal overlap: `tstzrange` overlap on periods
- Shared-account count: aggregate distinct accounts in intersection of item period sets
- Visit order: order periods by `started_at` per item
- Hot accounts: `COUNT(DISTINCT item_id)` group by `account_id`
- Shortest path / bipartite graph: derive edges `(item_id, account_id)` from periods (optionally materialized later)

Suggested future materialized view:

```sql
item_account_edges(item_id, account_id, first_seen, last_seen, total_duration)
```

---

## 7. Critical case: identical metadata + same nonce

Because neither `nonce` nor `strict_fingerprint` is unique to one `canonical_items` row:

- Multiple active items may share the same nonce and fingerprint.
- Observations matching that evidence produce **multiple candidates**.
- Resolution may stay `ambiguous` even at high feature similarity.
- Location updates must not steal an open period from item X to assign to item Y based only on nonce match when another clone exists.

See `ITEM_IDENTITY.md` § duplicate clones.

---

## 8. Migration / versioning notes

- Fingerprint algorithm version stored in `admin_settings` and optionally prefixed in fingerprint strings (`v1:...`)
- When algorithm changes, recompute in a batch job; keep old identifiers invalidated, not deleted
