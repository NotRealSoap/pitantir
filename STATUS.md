# Pitantir — Implementation Status

Last updated: 2026-07-13

## Current phase

Live Hypixel Pit inventory scanning wired (in addition to mock)

## Hypixel scans

1. Save key on `/settings`
2. Restart worker (loads `.env` / `apps/web/.env.local`)
3. Worker uses `INVENTORY_SOURCE=hypixel_pit`
4. Scan now resolves Mojang UUID if missing, fetches Pit inv/enderchest/stash, extracts books
5. Pit `ExtraAttributes.nonce` ints are coerced to strings (not dropped)

## Validation

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## Next

T21 multiplicity / T25–T28 location engine / T36 unresolved queue; continue hardening NBT field paths as live Pit books appear.
