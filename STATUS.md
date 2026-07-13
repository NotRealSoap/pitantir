# Pitantir — Implementation Status

Last updated: 2026-07-13

## Current phase

Account inventory-history explorer (PitPanda current-owner index + local ownership enrichment) is available at `/account`.

## Account inventory history

1. Open `/account` and enter a Minecraft username or UUID
2. Server resolves profile via Mojang, pages PitPanda `current_owner` search (bounded)
3. Detail `GET /api/item/{_id}` fills `owners` when list rows omit history
4. Indexed items are linked into canonical identity; PitPanda `owners` are persisted as local `import` periods + `import_presence` events (`uncertain`, idempotent)
5. Local Hypixel scan periods/events still enrich by nonce when Postgres is configured
6. Graph + timeline remain index-based — never claimed as exhaustive Hypixel truth

## Hypixel scans

1. Save key on `/settings`
2. Restart worker (loads `.env` / `apps/web/.env.local`)
3. Worker uses `INVENTORY_SOURCE=hypixel_pit`
4. Scan extracts nonce-bearing mystics (Nonce + item UUID)
5. `process_scan` auto-resolves → location engine updates presence / gaps / moves

## Location engine (T25–T28)

- Presence open on resolve; close + unknown gap on successful absence
- Failed scans never close presence
- Confirmed moves when absence on A then presence on B
- Uncertain + contradicted when dual open presence (non-clone)
- Idempotent `item_location_events` (reprocess safe)
- Item page shows ownership events + timeline with usernames

## Validation

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build:web
```

## Next

T21 multiplicity matching; T36 unresolved queue; auth gate; mystic UI polish.
