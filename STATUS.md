# Pitantir — Implementation Status

Last updated: 2026-07-13

## Current phase

Live Hypixel mystic scans + location engine (T25–T28) for ownership history across managed accounts.

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
pnpm typecheck && pnpm lint && pnpm test
```

## Next

T21 multiplicity matching; T36 unresolved queue; auth gate; mystic UI polish.
