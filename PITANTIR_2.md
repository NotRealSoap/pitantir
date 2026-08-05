# Pitantir 2.0

Operator shell for researching Hypixel Pit mystic lineage. Backend engines (scans, identity, Downwatch, Discord webhooks, PitPanda/Hypixel inventory) stay; the **product chrome is replaced**.

## Navigation

| Tab | Route | Purpose |
|---|---|---|
| **API** | `/api-board` | Hypixel production-key roster: who is being pinged, online/offline queues, ping age |
| **News** | `/news` | Chronological activity feed with category filters |
| **Player Lookup** | `/lookup` | PitPal-shaped inspect of any IGN |
| **Duped** | `/duped` | Suspicious / dupe lineage tracker |
| **Extras** | `/extras` | Downwatch add/exclude + Discord webhook setup (**unchanged behavior**) |

Legacy routes (`/accounts`, `/events`, `/settings`, …) may remain reachable for transition but are not primary nav.

## API board

- Roster = accounts on the Hypixel production watchlist (not ownership-only contacts).
- **Online** (alpha): green perimeter; ping target ~**15s** (shown as intended cadence; actual worker budget may throttle).
- **Offline queue**: ordered by next ping; target ~**30m**, staggered.
- **High Activity** (operator tag / notes): target ~**5m**.
- **Recently Online** (seen online within **10 minutes**): yellow perimeter even if currently offline.
- Right side of each row: **time since last successful ping** (`lastSuccessScanAt`).
- Failed pings ≠ empty inventory / confirmed offline.

## News

- Chronological list: account + timestamp + action.
- Filters: **All** · **Online/Offline** · **Item gains/transfers** (`inventory_changed` / item±).
- Same event stream powers the Duped day inspector.

## Player Lookup (PitPal-shaped)

Reference: PitPal Player Lookup + item details modal.

- Search by IGN.
- Left: head, rank/name when known, **Level**, **Total XP** under level, **Joins** (not Guild), 7-day Δ beside stats when available.
- Status: online/offline, last save, bounty when available.
- **Storage** order: **Ender Chest → Inventory → Stash** (stacked sections, not only tabs).
- Left-click item → owner history + Suspicious controls.
- Under nonce: checkbox **Suspicious for 6/17/26 Dupe** → places on Duped tracker with a Pitantir-specific display id.

### Pitantir-specific identifiers (Suspicious only)

- Canonical PK remains internal UUID.
- Display numerals assigned when operator tags Suspicious:
  - **Arabic** — mystic swords / pants / bows where shared nonce implies duplication research.
  - **Roman** — Rage Pants / Dark Pants (and similar) when you attribute Suspicious.
- Manual inputs/deletes on the Duped tracker are **absolute authority**.

## Duped Item Tracker

- Black grid; Y axis = time descending toward present; nodes = owners/observations for a tracked Pitantir id (or nonce family board).
- Nonce search lists iterations / family members.
- **Solid** edge = confirmed / operator-drawn continuity.
- **Dotted** edge = unverified continuity; **toggle** to hide dotted inference (nodes remain).
- Day scrub from **2026-06-05 → today**: selecting a day shows that day’s **News** on the left.

## Constants (do not upend)

- **Pitantir Downwatch** — list semantics, Discord `!downwatch` / `!dw`, role ping on PitPal DOWN for the **ping** list; **quiet** list posts the same webhook message without mentioning the role.
- **Webhook setup** — channel routing and delivery behavior.

Controls for both live under **Extras**.

## Data sources (known constraints)

- Hypixel key: inventory scans + presence hints; respect quota (15s×N online will require budget gates).
- PitPanda keyed `/api/players/:tag`: decoded bags for Lookup when configured.
- PitPal: lobbies / DOWN — not full inventory.
- Nonce is evidence, not uniqueness; graphs must not imply a single lineage for a shared nonce without Pitantir ids.

## Cadence note

UI documents **intended** API cadences (15s / 5m / 30m). Enforcing them on the worker is gated by Hypixel remaining budget and existing rate-limit / 140er rules — never silently burn the key to match the mockup.
