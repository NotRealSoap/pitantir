# Pitantir — Implementation Status

Last updated: 2026-07-13

## Current phase

Phase 8 — Items & scans UI complete (T33–T35)

## Browse loop

| Page | Path |
|---|---|
| Account history | `/accounts/[id]` |
| Items list | `/items` |
| Item detail | `/items/[id]` |
| Scan history | `/scans` |
| PitPanda search | `/search` |

## Next task

**T21** multiplicity matching → **T25–T28** location engine → **T36** unresolved queue.

## Validation

```bash
pnpm typecheck && pnpm lint && pnpm test   # 49 tests
```

Pull + restart `dev` / worker, then open `/items` and `/scans`.
