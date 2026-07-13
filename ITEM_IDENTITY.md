# Pitantir — Item Identity

## 1. Core rule

**A canonical item’s primary key is always an application-generated UUID.**  
Nonces, fingerprints, external IDs, and inventory slots are evidence used to *propose* identity. They never become the database primary key and never alone prove uniqueness.

## 2. Identity categories

| Category | When | Default auto-resolve? |
|---|---|---|
| `unique_nonce_candidate` | Nonce seen; no other active item currently shares it | Yes, if fingerprints consistent |
| `duplicate_nonce` | ≥2 active items share nonce, or operator marked as clone family | No — require disambiguation rules |
| `nonce_less` | No nonce; rely on imports + continuity + manual links | Rarely; usually review |
| `unknown` | Insufficient evidence | No |

Category is a *current classification*, not an immutable label. It can change when collisions are discovered.

## 3. Identifiers

One item may have many identifiers. One identifier value (especially a nonce) may attach to many items.

### 3.1 Kinds

- `nonce` — Minecraft book nonce / generation-related unique-ish field when present
- `strict_fingerprint` — hash of strongly identifying normalized fields
- `loose_fingerprint` — hash of weaker fields (title/author/page-count class)
- `external_ref` — `(source, value)` namespaced third-party ID
- `manual_tag` — operator-assigned label
- `legacy_id` — migrated internal IDs from prior systems (still not PK of record)

### 3.2 Namespacing

External refs are unique only within a source:

```text
(source=bookwiki, value=128)  ≠  (source=sheet, value=128)
```

Linking both to one canonical item means two `item_identifiers` rows, same `item_id`, different `source`.

## 4. Fingerprints

### 4.1 Normalization

Before hashing, normalize:

- Title / author Unicode NFKC, trim, collapse whitespace
- Page text: normalize line endings, optionally ignore cosmetic variants if documented
- Generation / component fields as extracted by scanner version
- Explicitly exclude volatile inventory-only fields (slot, count if always 1, display glitches)

Document the exact field list in code as `FINGERPRINT_SPEC_VERSION`.

### 4.2 Strict vs loose

| | Strict | Loose |
|---|---|---|
| Purpose | Strong match evidence | Clustering / candidate recall |
| Typical inputs | title, author, page content hash, generation bits, nonce if present | title, author, page count |
| Collision meaning | Likely same *content*, not necessarily same *instance* | Weak similarity |

**Important:** Identical strict fingerprints do **not** imply a single canonical item when nonces collide or when nonce-less duplicates exist.

## 5. Observation resolution statuses

| Status | Meaning |
|---|---|
| `resolved` | Auto assigned to exactly one item with high confidence |
| `probable` | One best candidate above threshold but below auto-resolve |
| `ambiguous` | Multiple plausible candidates; system will not choose |
| `unresolved` | No acceptable candidate |
| `manually_resolved` | Operator assigned (may override auto rules) |

`probable` items may optionally update location with `certainty=probable` or be held for review (MVP recommendation: **hold location writes for probable** unless settings allow).

## 6. Auto-resolution algorithm (MVP)

For each new observation `O`:

1. **Extract** nonce `N`, strict fingerprint `SF`, loose fingerprint `LF`.  
2. **Candidate recall**  
   - Items with identifier nonce = `N` (if `N` present)  
   - Items with strict fingerprint = `SF`  
   - Items linked via prior observations on same account with strong continuity (optional MVP+)  
   - Import-linked items matching `N` or `SF`  
3. **Filter** out `merged_away` / deleted items (follow `merged_into_item_id` if needed).  
4. **Score** candidates (see §7).  
5. **Decide**  
   - If `N` present AND exactly one active item has nonce `N` AND score ≥ `T_auto` AND no competing clone-family flag → `resolved`  
   - If `N` present AND ≥2 active items share `N` → `ambiguous` (even if metadata identical)  
   - If `N` absent AND exactly one item matches `SF` with score ≥ `T_auto` AND that item is not in a known duplicate cohort → `resolved` or `probable` based on threshold  
   - If multiple high scores → `ambiguous`  
   - If none → `unresolved` (optionally auto-`create_item` when settings allow for novel unique nonces)  
6. Persist `observation_candidates` always when ≥1 candidate considered.  
7. Write `identity_decisions` row for auto resolves and creates.

### 6.1 Novel unique nonce policy

Configurable setting `auto_create_on_novel_nonce` (default **true** for MVP tracking mode):

- If nonce present, zero candidates → create canonical item, attach nonce + fingerprints, mark `resolved` / `create_item`  
- If nonce absent → **do not** auto-create from scan alone in MVP unless operator enables `auto_create_nonce_less` (default **false**)

## 7. Scoring (illustrative weights)

| Signal | Weight guidance |
|---|---|
| Exact nonce match when nonce is unique in DB | Very high |
| Exact nonce match when nonce is known colliding | Medium recall only; not decisive alone |
| Strict fingerprint match | High |
| Loose fingerprint match | Low–medium |
| Prior presence on same account + recent open period | Medium continuity bonus |
| Import claim agreement | Medium–high depending on claim confidence |
| Conflicting open presence on another account without disappearance | Penalty / contradiction |

Scores are explanatory via `reasons` JSON for the resolution UI.

## 8. Duplicate clones: same nonce + identical metadata

This is the hardest case and a first-class design requirement.

### 8.1 Scenario

Two (or more) distinct physical books were duplicated such that:

- `observed_nonce` is identical  
- `strict_fingerprint` is identical  
- Only instance multiplicity and location history differ

### 8.2 What the system must NOT do

- Collapse them into one canonical item because evidence “looks the same”
- Assume an observation on Account B is the same instance last seen on Account A solely due to matching nonce+fingerprint when another clone is unaccounted for
- Use nonce uniqueness constraints in the database

### 8.3 What the system MUST do

1. Allow multiple `canonical_items` rows sharing the same nonce identifier values.  
2. Maintain a **clone family** concept (MVP: derive from shared nonce among `duplicate_nonce` items; optional `clone_families` table deferred).  
3. When observing a matching nonce+fingerprint:  
   - Build candidate set = all active items in that nonce family  
   - Prefer continuity: items whose open location period is on the scanned account  
   - If exactly one family member has an open confirmed period on this account → resolve to that item  
   - If zero family members are expected on this account, but one family member recently disappeared elsewhere → mark `probable` or `ambiguous` with `move_uncertain` — **do not** auto-confirm move if more than one family member is in unknown/open elsewhere  
   - If count of matching items observed in this scan (`K`) differs from count of family members with open periods on this account (`M`):  
     - If `K > M` → excess observations are `unresolved`/`ambiguous`; may create new canonical items only with manual approval (or explicit setting)  
     - If `K < M` → mark missing members disappeared from this account only after successful scan; do not invent destinations  
4. Surface clone families prominently in item UI and resolution workspace.

### 8.4 Multiplicity tracking

Per scan, group observations by `(nonce, strict_fingerprint)` (or by nonce alone if fingerprint missing). Resolution runs in **groups**, not only per single observation, so the system can match a multiset of sightings to a multiset of expected items on that account.

MVP implementation sketch:

```text
expected = open periods on account for items in nonce family
observed = observations in scan with that nonce
match by continuity first; remainder → ambiguous queue
```

## 9. Ambiguous and uncertain matches

Ambiguity is a successful outcome of the resolver when data is insufficient.

Operators use the **manual identity-resolution workspace** to:

- Assign observation → existing item  
- Create new item from observation  
- Mark observation as not-a-tracked-book (deferred filter status if needed)  
- Split or merge items

All actions write `identity_decisions`.

## 10. Merge operations

**When:** Two canonical items are later determined to be the same physical book.

**Procedure (transactional):**

1. Choose survivor `S` and loser `L`.  
2. Snapshot both states into `identity_decisions.before_state`.  
3. Move identifiers from `L` → `S` (invalidate duplicates).  
4. Re-point observations `canonical_item_id` from `L` → `S` (or keep historical pointer and add redirect — MVP: re-point with decision audit).  
5. Merge location periods:  
   - Detect contradictions (overlapping confirmed presence on different accounts)  
   - Mark conflicting periods `certainty=contradicted` and create review flags  
   - Otherwise coalesce compatible periods  
6. Set `L.status = merged_away`, `L.merged_into_item_id = S`.  
7. Rewrite/append location events carefully with new idempotency keys referencing the decision id.  
8. Store `after_state`.

**Never** hard-delete `L`.

## 11. Split operations

**When:** One canonical item is later determined to represent multiple distinct books (common after discovering duplication).

**Procedure:**

1. Choose source item `S` and create new item(s) `N1..Nk`.  
2. Operator assigns subsets of observations / import claims / identifiers to each.  
3. Nonce identifiers may be **copied** to multiple items (not moved exclusively) when they are shared evidence.  
4. Rebuild location periods per resulting item from assigned observations only (do not invent gaps incorrectly).  
5. Mark `S` as `split_source` if fully replaced, or keep `S` as one surviving instance.  
6. Audit with full before/after observation membership lists.

## 12. Manual resolution rules

- Manual assignment sets `resolution_status = manually_resolved`  
- Manual can override auto, but must record rationale  
- Manual resolve that creates a confirmed move must still obey scanning rules: presence on destination requires observation; disappearance from source requires successful scan absence (or explicit operator override flagged `uncertain`)

## 13. Confidence model

Item-level `identity_confidence`:

| Level | Typical meaning |
|---|---|
| `high` | Unique nonce history or strong manual confirmation |
| `medium` | Consistent fingerprints + some continuity |
| `low` | Sparse evidence / nonce-less import only |
| `contested` | Open contradictions or unresolved clone conflicts |

Observation-level `confidence` is a numeric score for that assignment.

## 14. Audit requirements

Every identity-affecting action must record:

- Decision type  
- Actor  
- Related observation/import IDs  
- From/to item IDs  
- Before/after snapshots  
- Rationale  
- Timestamp  

UI must be able to show the decision timeline on an item page.

## 15. Test matrix (identity)

Must have automated tests for:

1. Novel unique nonce → auto create + resolve  
2. Second item appears with **same nonce + same strict fingerprint** on another account while first still present → second observation does not steal first item; ambiguity or new-item review  
3. Two clones both open on same account; scan sees two matching books → both resolve via multiplicity matching  
4. Two clones expected; scan sees one → one disappearance, not a merge  
5. Merge of two items with non-overlapping histories succeeds  
6. Merge with contradictory overlapping presence flags contradiction  
7. Split reassigns observations and rebuilds periods  
8. External IDs from two sources with value `128` remain distinct until linked  
9. Re-running resolver on same observation does not duplicate candidates uniquely constrained  
10. `manually_resolved` not overwritten by later auto pass unless explicitly “reopen”
