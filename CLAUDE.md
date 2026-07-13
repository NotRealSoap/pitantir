# CLAUDE.md — Working Guide for Pitantir

This file orients coding agents and humans implementing Pitantir. Product requirements live in the other root docs; this file states **how to work** without violating them.

## Read first

1. `SPEC.md` — purpose and constraints  
2. `ARCHITECTURE.md` — package boundaries and MVP infra limits  
3. `DATA_MODEL.md` — schema truth  
4. `ITEM_IDENTITY.md` — identity, merges, splits, clone collisions  
5. `SCANNING_RULES.md` — scan idempotency and location inference  
6. `IMPORT_FORMAT.md` — external claims  
7. `MVP_TASKS.md` — ordered tasks  

If code and docs disagree, **fix the docs** or update docs in the same change with rationale.

## Project one-liner

Pitantir tracks historically significant Minecraft books across managed accounts, preserving uncertain identity and uncertain location instead of inventing certainty.

## Non-negotiable rules

1. **Canonical item PK = internal UUID only.** Never use nonce, fingerprint, or external ID as a primary key.  
2. **Nonce is evidence, not uniqueness.** Multiple canonical items may share a nonce.  
3. **Identical metadata + identical nonce can still be two items.** Ambiguity is allowed; silent collapse is not.  
4. **Observations are stored before confident assignment.** Raw fields are immutable.  
5. **Scan failure ≠ empty inventory.** Failures must not close location periods.  
6. **Reprocessing must be idempotent.** No duplicate observations or movement events.  
7. **Disappearance from A does not imply move to B.** Confirmed moves need explicit gates in `SCANNING_RULES.md`.  
8. **External IDs are namespaced by source.**  
9. **Identity decisions are audited.** Merges/splits append history; do not hard-delete evidence.  
10. **Scanner runs in `apps/worker`, not in Next.js request handlers.**

## Architecture habits

- Put pure logic in `packages/shared` (fingerprints, scoring, multiplicity matching).  
- Put schema/repos in `packages/db`.  
- Web enqueues jobs; worker performs Minecraft I/O and heavy processing.  
- Upstream item evidence (PitPanda, future Hypixel) flows through `ItemDataProvider` adapters — see `ITEM_DATA_PROVIDERS.md`.  
- Never call upstream providers from the browser; only server routes may use provider credentials.  
- Prefer DB-backed jobs for MVP; do not add Redis/Bull/Temporal unless docs change.  
- Prefer Drizzle + explicit SQL for overlap/temporal queries.

## Identity implementation reminders

- Candidate recall should over-fetch; decision step should under-commit.  
- Always persist `observation_candidates` when evaluation happens.  
- Auto-create on novel nonce is a setting (default on); auto-create nonce-less from scans default off.  
- Clone families: resolve with multiset matching per account scan, not single-row nonce lookup.  
- `manually_resolved` observations should not be clobbered by auto reprocess unless explicitly reopened.  
- Merge/split must write `identity_decisions` with before/after snapshots.

## Location implementation reminders

- Only successful scans affect presence/absence.  
- Close presence → open unknown gap by default.  
- Use `item_location_events.idempotency_key` (or equivalent unique key).  
- Display “last observed” separately from “current known location”.  
- Import-derived periods are probable/import-sourced; do not override confirmed scan periods silently.

## UI expectations (MVP)

Implement pages listed in `SPEC.md`. For visually led surfaces later, follow the repo’s frontend design rules; admin/data UIs may be plain and dense. Prefer clarity of uncertainty (badges for ambiguous, unknown, contradicted) over polished marketing layouts.

## Testing expectations

Before claiming a task done:

- Add or extend automated tests named after the rule they protect  
- Include at least one test where **two distinct items share the same nonce and strict fingerprint**  
- Include at least one test where a **failed scan does not alter locations**  
- Include at least one test that **reprocessing a scan does not duplicate events**

## What not to do

- Do not “just unique index the nonce” to simplify queries  
- Do not delete observations to fix identity mistakes — correct via decisions  
- Do not run inventory fetches inside Server Components / route handlers  
- Do not expand scope into deferred infra from `ARCHITECTURE.md` / `MVP_TASKS.md` without an explicit doc update  
- Do not invent confirmed moves from sparse “last seen / next seen” pairs when clone ambiguity exists  

## Suggested agent workflow

1. Pick the next task id from `MVP_TASKS.md`  
2. Re-read the relevant rule doc section  
3. Implement minimal code for that task  
4. Run targeted tests  
5. Update docs only if behavior/schema intentionally changes  
6. Commit with message referencing task id (`T19: auto-resolve unique nonce`)  

## Definition of MVP done

All tasks through **T45** complete, with the false-movement and identical-nonce twin regression packs green, and operator can manage accounts, review unresolved identities, import claims, and view item/account timelines without false certainty.
