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
- **Callers (server only):**
  - `POST /api/item-search` — domain item search
  - `POST /api/account-history` — account inventory-history explorer (`/account`)
- **Capabilities:** global item search, exact nonce, current owner, past owner, item detail (`owners` timeline)
- **Query translation (adapter only):**
  - `exact_nonce` → `nonce{value}`
  - `current_owner` → `uuid{playerName}`
  - `past_owner` → `past{playerName}`
- **HTTP:**
  - Search: `GET https://pitpanda.rocks/api/itemSearch/{query}?page={n}&sort=-lastseen`
  - Detail: `GET https://pitpanda.rocks/api/item/{_id}` — includes `owners: [{ _id, uuid, time }]` ownership timeline (search list rows often omit `owners`)
- **Auth header:** `X-API-Key`
- **Pagination:** one page per request; account history bounds pages + detail lookups
- **Caching:** in-memory TTL cache per identical validated request
- **Rate limits:** app-level per-IP limits on search and account-history routes; adapter retries HTTP 429 with backoff
- **History caveat:** PitPanda ownership is index/search based, not exhaustive Hypixel truth

### Observed response shape (do not assume item fields)

```json
{ "success": true, "items": [ ... ] }
{ "success": false, "error": "..." }
```

Detail:

```json
{
  "success": true,
  "item": {
    "_id": "...",
    "owner": "<undashed uuid>",
    "owners": [{ "_id": "...", "uuid": "<undashed>", "time": "ISO" }],
    "enchants": [{ "key": "...", "level": 1 }],
    "nonce": 0,
    "lives": 0,
    "maxLives": 0,
    "item": { "name": "§c..." },
    "lastseen": "ISO"
  }
}
```

Each search `items[]` element is stored verbatim in `rawPayload`. Prefer local DB enrichment; bounded detail lookups only when `owners` is missing.

## Local search (separate)

`LocalItemSearchRepository` searches canonical items, identifiers, and observations already in our database. It is **not** an `ItemDataProvider` and must not call PitPanda.

## Future: Hypixel provider (partially implemented)

`HypixelPitInventorySource` (`packages/shared/src/inventory/hypixel-pit.ts`) powers **worker inventory scans**:

1. Resolve Minecraft UUID from username when missing (Mojang lookup).
2. `GET https://api.hypixel.net/v2/player?uuid=…` with `API-Key` header (`HYPIXEL_API_KEY`).
3. Decode Pit NBT `inv_contents` / `inv_enderchest` into book observations.
4. Persist resolved UUID onto the account row.

Env: `INVENTORY_SOURCE=hypixel_pit` (set automatically from `/settings` when saving the key).

A broader Hypixel `ItemDataProvider` for SkyBlock/search remains deferred. PitPanda remains the upstream **search** provider.

`ProviderCapabilities.playerInventorySnapshot` would be `true` for a future search-facing Hypixel provider; the worker inventory port is separate from `ItemDataProvider`.

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
| `apps/web/app/api/account-history/route.ts` | Account inventory-history route |
| `apps/web/app/search/page.tsx` | Search UI |
| `apps/web/app/account/page.tsx` | Account inventory-history UI |
