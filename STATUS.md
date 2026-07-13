# Pitantir — Implementation Status

Last updated: 2026-07-13

## Current phase

Live Hypixel Pit inventory scanning wired (mock still available). Product focus: track mystic **nonces** across managed accounts (swords/bows/pants/etc.), not only written books.

## Hypixel scans

1. Save key on `/settings`
2. Restart worker (loads `.env` / `apps/web/.env.local`)
3. Worker uses `INVENTORY_SOURCE=hypixel_pit`
4. Scan now resolves Mojang UUID if missing, fetches Pit inv / ender / armor / stash / mystic well
5. Extracts **nonce-bearing mystics** (and books); integer `ExtraAttributes.Nonce` coerced to string
6. Persists lore + `CustomEnchants` (e.g. Billionaire III / Lifesteal III) on observations

## Validation

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Dump one stored inventory item from the latest scan (local):

```bash
DATABASE_URL=postgresql://pitantir:pitantir@127.0.0.1:5432/pitantir \
  npx pnpm@10.11.0 --filter @pitantir/worker dump-scan-item -- billionaire
```

## Next

T21 multiplicity / T25–T28 location engine / T36 unresolved queue; UI that shows mystic enchants/lore clearly (not book-only wording).
