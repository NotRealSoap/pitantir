# Pitantir — Product & Technical Specification

## 1. Purpose

Pitantir tracks historically significant Minecraft book items across a configurable list of Minecraft accounts. It answers:

- Has a previously unknown tracked book appeared?
- Has a known book moved between accounts?
- Where is each book currently known to be?
- On which accounts has each book previously been observed?
- Which books have shared accounts in their histories?
- Were books present on the same account during overlapping time periods?

Operators must be able to add, disable, and manage Minecraft accounts at any time without interrupting scanning of other accounts.

## 2. Non-goals (MVP)

- Public multi-tenant SaaS with arbitrary user sign-up
- Real-time in-game plugins or client mods
- Automatic trading-market valuation
- Guaranteeing absolute uniqueness of Minecraft nonces
- Fully automatic resolution of every ambiguous identity case
- Production-grade horizontal scaling of the scanner fleet

## 3. Core concepts

### 3.1 Canonical item

A **canonical item** is the application’s permanent record of a distinct physical book instance. Every canonical item has an application-generated UUID that is the only primary key used for that item. External identifiers (nonces, third-party IDs, fingerprints) are evidence attached to the item, never its primary key.

### 3.2 Nonce

A **nonce** is identity *evidence*, not a guaranteed unique identifier. Nonces may collide across distinct duplicated books. Multiple canonical items may share one nonce. One canonical item may accumulate multiple identifiers over time.

### 3.3 Book categories

| Category | Description |
|---|---|
| **Unique-nonce candidate** | Book with a nonce believed unique among tracked items; still treated as evidence, not a hard PK |
| **Known duplicate / colliding nonce** | Distinct books that share a nonce; require instance disambiguation |
| **Nonce-less** | No usable nonce; identity established via imported history, manual linking, and observational continuity |

### 3.4 Observation

An **observation** is a raw sighting of a book-like item during a successful scan of one account. Observations are stored *before* assignment to a canonical item. Reprocessing the same scan must not create duplicate observations or movement events.

### 3.5 Location state

Location is temporal and uncertain. The system distinguishes:

| State | Meaning |
|---|---|
| Confirmed presence | Item observed on an account at a known time |
| Disappearance | Item was present, then absent from that account on a later successful scan |
| Confirmed move | Item disappeared from A and appeared on B with evidence sufficient to link the events |
| Unknown location | No confirmed current account; includes after disappearance without a confirmed destination |
| Timing-uncertain movement | Scan gaps make direct A→B inference unsafe |
| Concurrent / contradictory | Overlapping or conflicting presence evidence |

**Critical rule:** Disappearing from Account A does **not** imply the item moved to Account B, even if a similar book appears on B later.

## 4. Functional requirements

### 4.1 Account management

- Create, update, enable/disable, and soft-delete tracked Minecraft accounts
- Store scan credentials / identifiers needed by the scanner (secrets never exposed in UI responses)
- Configure per-account scan priority and interval overrides
- Disabling an account stops new scans; existing history remains

### 4.2 Scanning

- Periodic scanning of enabled accounts via a worker separate from the web request path
- Persist every scan attempt with status: queued, running, success, failure, cancelled
- On success: persist inventory snapshot + per-item observations
- On failure: record error; **do not** treat as empty inventory; **do not** close open location periods as disappearances
- Idempotent processing keyed by scan identity

### 4.3 Identity resolution

- Assign observations to canonical items when confident
- Leave observations unresolved, probable, or ambiguous when not
- Support candidate lists with confidence scores
- Support manual resolution, merges, and splits
- Record a complete audit history of identity decisions

### 4.4 Historical location

For each canonical item, maintain:

- Current known location (account or unknown)
- Chronological location timeline with open/closed periods
- Unknown-location gaps
- Provenance linking timeline segments to observations and imports
- Confidence / certainty flags on each segment

### 4.5 External imports

- Import historical claims from namespaced external sources
- Preserve source, source-specific ID, original payload, import date, confidence, review status, provenance
- External IDs are unique only within `(source, external_id)` — never globally
- Imported claims may seed canonical items or remain pending review

### 4.6 Overlap analysis (schema-ready; full UI may be post-MVP)

Design must support without remodel:

- Accounts shared by ≥2 books at any time
- Overlapping presence intervals on the same account
- Shared-account counts
- Visit order of books across accounts
- High-traffic accounts (many distinct tracked books)
- Shortest path between books via shared accounts
- Bipartite item↔account graph

### 4.7 Required interfaces

1. Items list  
2. Individual item history  
3. Accounts list  
4. Individual account history  
5. Scan history and failures  
6. Unresolved identity observations  
7. Manual identity-resolution workspace  
8. Historical-data import review  
9. Overlap explorer  
10. Administrative settings  

## 5. Item page content requirements

Each item detail view must show:

- Canonical identity (internal UUID + display label)
- Known identifiers (nonce(s), external IDs, fingerprints)
- Current known location
- Identity confidence
- Complete chronological location history with unknown gaps
- Source provenance
- Raw supporting observations
- Books with overlapping account histories (at least a basic list in MVP)

## 6. Hard constraints

1. Application UUID is the only primary key for canonical items.  
2. Nonces are never unique constraints on canonical items.  
3. Raw observations are immutable after insert (except resolution linkage fields).  
4. Scan failures never imply empty inventory.  
5. Reprocessing a scan is idempotent.  
6. External IDs are namespaced by source.  
7. Merge/split operations are reversible via audit trail (logical reverse, not silent rewrite).  
8. Two books with identical metadata and the same nonce may still be distinct canonical items (see `ITEM_IDENTITY.md`).

## 7. Success criteria (MVP)

- Operators can manage accounts and see scan success/failure history
- Successful scans produce durable observations
- High-confidence unique-nonce books auto-resolve and update location timelines safely
- Ambiguous / colliding / nonce-less cases queue for review instead of inventing false moves
- Imports can be reviewed and linked without losing provenance
- Item and account pages show trustworthy history with unknown gaps explicit
- Automated tests cover identity edge cases, scan idempotency, and false-movement prevention

## 8. Document map

| Document | Contents |
|---|---|
| `ARCHITECTURE.md` | System components, stack, deployment boundaries |
| `DATA_MODEL.md` | Entities, fields, relations, indexes, deletion |
| `ITEM_IDENTITY.md` | Identity categories, resolution, merge/split, collision cases |
| `SCANNING_RULES.md` | Scan lifecycle, observations, location inference |
| `IMPORT_FORMAT.md` | External source import schemas and review flow |
| `MVP_TASKS.md` | Ordered, independently testable implementation tasks |
| `CLAUDE.md` | Working rules for future implementation agents |

## 9. Design review — identical metadata + same nonce

**Scenario:** Two distinct physical books share the same nonce and the same strict fingerprint (content-identical duplicates).

**Risks if mishandled**

- Unique DB constraints on nonce would illegally collapse instances
- Auto-resolve-by-nonce would “teleport” item 1 to wherever a twin is seen
- Presence on B after absence on A would fabricate a confirmed move when the sighting is actually item 2
- Single-row matching cannot explain two simultaneous copies on one account

**Design responses (must hold in implementation)**

| Mechanism | Where specified |
|---|---|
| Non-unique nonce / fingerprint indexes; internal UUID PK only | `DATA_MODEL.md` |
| Category `duplicate_nonce` + ambiguous resolution when ≥2 active items share a nonce | `ITEM_IDENTITY.md` |
| Multiset matching of observations to expected open items per account | `ITEM_IDENTITY.md` §8.4 |
| Continuity preference only when exactly one family member is open on the scanned account | `ITEM_IDENTITY.md` §8.3 |
| Confirmed moves require absence+presence on the same canonical ID and clone-ambiguity checks | `SCANNING_RULES.md` §6.3–6.6 |
| Explicit regression pack T20 / T44 | `MVP_TASKS.md` |

**Accepted limitations (MVP)**

- The system cannot magically distinguish twins from a single observation off-account with no continuity; it will mark `ambiguous` / `move_uncertain` and queue review rather than guess
- Clone family is derived from shared nonce among active items in MVP; a dedicated `clone_families` table is deferred
- Operator judgment remains required for many twin cases — the product goal is trustworthy uncertainty, not false precision
