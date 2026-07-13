# Item Data Providers

Pitantir separates **local indexed search** from **upstream item-data providers**. Upstream providers supply immutable evidence that is normalized into observations and passed to the identity-resolution system. They never assign canonical item IDs directly.

## Provider-neutral boundary

| Layer | Responsibility |
|---|---|
| Domain search input | `exact_nonce`, `current_owner`, `past_owner` — no PitPanda syntax |
| `ItemDataProvider` | Capability-aware upstream search contract |
| Provider adapter (PitPanda) | Auth, HTTP, query translation, response parsing, retries |
| `UpstreamObservationIngestor` | Normalize → observation rows → auto-resolve (non-destructive) |
| `LocalItemSearchRepository` | Query our PostgreSQL index only |

Application services depend on `ItemDataProvider`, not PitPanda.

## PitPanda (current)

- **Env:** `PITPANDA_API_KEY` (server-only), `ITEM_DATA_PROVIDER=pitpanda` (default)
- **Package:** `packages/shared/src/item-data/providers/pitpanda/`
- **Caller:** `apps/web` API route `POST /api/item-search` only — never the browser
- **Capabilities:** global item search, exact nonce, current owner, past owner
- **Query translation (adapter only):**
  - `exact_nonce` → `nonce{value}`
  - `current_owner` → `uuid{playerName}`
  - `past_owner` → `past{playerName}`
- **HTTP:** `GET https://pitpanda.rocks/api/itemSearch/{query}?page={n}&sort=-lastseen`
- **Auth header:** `X-API-Key`
- **Pagination:** one page per request; UI exposes explicit next page
- **Caching:** in-memory TTL cache per identical validated search + page
- **Rate limits:** app-level per-IP limit on `/api/item-search`; adapter retries HTTP 429 with backoff

### Observed response shape (do not assume item fields)

```json
{ "success": true, "items": [ ... ] }
{ "success": false, "error": "..." }
```

Each element of `items` is stored verbatim in `rawPayload`. No field names from item objects are required for normalization.

## Local search (separate)

`LocalItemSearchRepository` searches canonical items, identifiers, and observations already in our database. It is **not** an `ItemDataProvider` and must not call PitPanda.

## Future: Hypixel provider (not implemented)

A future `HypixelItemDataProvider` would:

1. Accept a **known player UUID** (domain input), not global text search.
2. Call Hypixel API endpoints for player inventory/profile data (server-side credentials).
3. Decode NBT/inventory structures in the adapter only.
4. Emit `NormalizedUpstreamItem` rows with `source: "hypixel"`, `observedAt`, and raw payload.
5. Feed the same `UpstreamObservationIngestor` — no changes to identity rules.

`ProviderCapabilities.playerInventorySnapshot` would be `true`; global search flags would be `false`.

A `CompositeItemDataProvider` could route `current_owner` to PitPanda and `player_inventory_snapshot` to Hypixel when both are configured.

## PitPal replacement note

No PitPal code existed in this repository. PitPanda replaces the previously planned PitPal integration at the provider adapter layer only.

## Files

| File | Role |
|---|---|
| `packages/shared/src/item-data/types.ts` | Provider interface + normalized types |
| `packages/shared/src/item-data/schemas.ts` | Validated API/search inputs |
| `packages/shared/src/item-data/ingestion.ts` | Observation ingest + identity handoff |
| `packages/shared/src/item-data/provider-factory.ts` | Server-side provider selection |
| `packages/shared/src/item-data/providers/pitpanda/*` | PitPanda adapter |
| `packages/db/src/search/local-item-search.ts` | Local DB search interface |
| `apps/web/app/api/item-search/route.ts` | Authenticated server route |
| `apps/web/app/search/page.tsx` | Search UI |
