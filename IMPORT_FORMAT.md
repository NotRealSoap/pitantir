# Pitantir — Import Format

## 1. Purpose

External communities and tools have historically tracked significant Minecraft books, including nonce-less copies. Pitantir imports those claims as **evidence with provenance**, not as authoritative canonical truth until reviewed or confidently linked.

## 2. Namespacing

Every external item ID is interpreted as:

```text
(source_key, external_item_id)
```

Examples:

| Source key | External ID | Meaning |
|---|---|---|
| `bookwiki` | `128` | BookWiki entry 128 |
| `collector_sheet` | `128` | Unrelated sheet row 128 |

These remain distinct `import_claims` and, if accepted, distinct `item_identifiers` (`kind=external_ref`) unless an operator/system decision links them to the **same** `canonical_items.id`.

## 3. Transport formats (MVP)

Support at least one machine format:

1. **JSON Lines** (`.jsonl`) — preferred  
2. **JSON array** file  

CSV may be deferred; if added, require a mapping config.

### 3.1 Batch envelope (optional JSON)

```json
{
  "source_key": "bookwiki",
  "exported_at": "2024-06-01T00:00:00Z",
  "provenance": {
    "url": "https://example.org/export",
    "exporter_version": "1.2.0",
    "notes": "public dump"
  },
  "claims": [ { "...": "claim objects" } ]
}
```

For JSONL, each line is one claim; `source_key` may be provided per line or as an upload form field.

## 4. Claim object schema

Zod-level logical schema:

```ts
{
  external_item_id: string,          // required, source-local
  nonce?: string | null,
  title?: string | null,
  author?: string | null,
  page_count?: number | null,
  pages?: string[] | null,           // optional full text
  fingerprints?: {
    strict?: string | null,          // if source already hashed
    loose?: string | null
  },
  identifiers?: Array<{
    kind: string,
    value: string,
    source?: string
  }>,
  locations?: Array<{
    account_username?: string | null,
    account_uuid?: string | null,
    seen_at?: string | null,         // ISO 8601
    until_at?: string | null,
    note?: string | null,
    confidence?: "high" | "medium" | "low" | "unknown"
  }>,
  confidence?: "high" | "medium" | "low" | "unknown",
  original?: Record<string, unknown>, // optional; if absent, whole claim stored
  provenance?: Record<string, unknown>,
  display_name?: string | null,
  notes?: string | null
}
```

### 4.1 Required fields

- `external_item_id`

Everything else is optional but richer claims improve linking.

### 4.2 Storage mapping

| Claim field | Stored on |
|---|---|
| entire raw claim | `import_claims.original_data` |
| normalized subset | `import_claims.normalized_claim` |
| `nonce` | `import_claims.observed_nonce` + normalized |
| primary location hint | denormalized claimed_* columns for queue UX |
| `confidence` | `import_claims.confidence` |
| envelope provenance ∪ claim provenance | `import_claims.provenance` |
| batch time | `import_claims.import_date` |

## 5. Import pipeline

```text
upload → hash payload → create import_batch
      → parse/validate each claim → insert import_claims (pending)
      → auto-suggest links (optional job)
      → operator review UI
      → accept / reject / link / create item
```

### 5.1 Batch idempotency

`UNIQUE (source_id, raw_payload_hash)` prevents re-importing an identical file.  
A modified export is a new batch; claims with same `external_item_id` across batches are related via index `(source_id, external_item_id)` for review (“updated claim”).

### 5.2 Per-claim uniqueness

`UNIQUE (source_id, external_item_id, batch_id)`.

## 6. Review statuses

| Status | Meaning |
|---|---|
| `pending` | Awaiting review |
| `needs_info` | Insufficient data |
| `accepted` | Claim trusted; may create/update item without full link UI finish |
| `linked` | Explicitly linked to `canonical_items` |
| `rejected` | Not used for identity/location |

MVP may treat `accepted` as “create item if needed + link”.

## 7. Applying an accepted/linked claim

Transactional effects (record `identity_decisions`):

1. Ensure `canonical_items` row exists (create or use selected).  
2. Upsert `item_identifiers` for `(external_ref, source_key, external_item_id)`.  
3. If nonce present, add `nonce` identifier (non-unique globally).  
4. For each `locations[]` entry:  
   - Try map username/uuid to `accounts`  
   - Create `item_location_periods` with `start_reason=import`, certainty from claim confidence (typically `probable` unless `high` and settings allow `confirmed`)  
   - Emit `import_presence` location events with idempotency keys including `import_claim_id`  
5. Never delete conflicting scan-derived periods; mark contradictions for review.

**Imports must not silently override confirmed scan observations.**

## 8. Confidence & provenance display

Item pages must show:

- Source name/key  
- External ID  
- Import date  
- Review status  
- Confidence  
- Link to original JSON  
- Which location segments were import-derived vs scan-derived

## 9. Example claims

### 9.1 Nonce-less historical book

```json
{
  "external_item_id": "42",
  "display_name": "Origin Codex",
  "title": "Origin Codex",
  "author": "Unknown",
  "page_count": 16,
  "confidence": "medium",
  "locations": [
    {
      "account_username": "CollectorA",
      "seen_at": "2019-04-12T00:00:00Z",
      "note": "screenshot era ownership",
      "confidence": "low"
    }
  ],
  "provenance": { "thread_url": "https://example.org/t/1" }
}
```

### 9.2 Colliding nonce noted by source

```json
{
  "external_item_id": "9001",
  "nonce": "aaa-bbb-ccc",
  "title": "Duplicated Relic",
  "notes": "Known dupe; sheet tracks copy #2",
  "confidence": "high",
  "identifiers": [
    { "kind": "manual_tag", "value": "dupe-family-aaa" }
  ]
}
```

Even if another claim also has nonce `aaa-bbb-ccc` and different `external_item_id`, both may later link to different canonical items.

## 10. Validation rules

- Reject claim missing `external_item_id`  
- Reject empty string IDs  
- Unknown fields allowed inside `original` / passthrough  
- Timestamps must parse as ISO 8601 if present  
- `source_key` must match a registered `external_sources.key` or be created in admin before import  

## 11. Security / safety

- Cap upload size  
- Store raw payload in DB (MVP) or filesystem path reference  
- Do not execute any embedded scripts/links  
- Sanitize display of titles/authors in UI  

## 12. Deferred import features

- Live sync connectors / APIs  
- Automatic continuous scrape  
- CSV mapping UI  
- ML-assisted matching beyond deterministic scores  
- Public crowdsourced submissions  

## 13. Tests

1. Two sources with same external id string create two claims  
2. Re-uploading identical file does not duplicate batch  
3. Accepting claim creates namespaced external_ref identifier  
4. Import location appears as probable/import-derived, not scan-confirmed  
5. Linking claim to item writes identity decision with provenance snapshot  
6. Rejected claim does not alter canonical items
