# Pitantir — Scanning Rules

## 1. Separation of concerns

Scanning is performed by the **worker**, never by interactive web request handlers.

Phases:

1. **Acquire** — claim job / create scan row  
2. **Fetch** — call Minecraft inventory source  
3. **Persist raw success/failure**  
4. **Process** — idempotent observation upsert  
5. **Resolve** — identity assignment attempts  
6. **Locate** — update location periods / events  

Steps 4–6 must be safe to retry.

## 2. Account eligibility

An account is scannable when:

- `deleted_at IS NULL`
- `enabled = true`
- `next_scan_at <= now()`
- no other active `scan_account` / running scan lease for that account

Disabled accounts retain history and may still appear in UIs.

## 3. Scan lifecycle

```text
queued → running → success → (processing_status: pending → processed)
                 → failure
                 → cancelled
```

### 3.1 Idempotency key

Each scan job carries an `idempotency_key`, e.g.:

```text
scan:{account_id}:{trigger}:{planned_window_or_uuid}
```

Manual “scan now” uses a fresh UUID suffix. Scheduled scans should use a stable key per scheduling slot to prevent duplicate enqueues, e.g. `scan:{account_id}:schedule:{floor_ts}`.

Inserting a scan with a duplicate key returns the existing row; do not create a second fetch.

### 3.2 Success

On success:

- Set `status=success`
- Set `observed_at` to the timestamp representing inventory truth time
- Store `raw_inventory` + `raw_inventory_hash`
- Set `item_count` to number of tracked book-like items extracted
- Enqueue / run processing

### 3.3 Failure

On failure:

- Set `status=failure` with `error_code` / `error_message`
- Leave `raw_inventory` NULL
- **Do not** write observations
- **Do not** mark items disappeared
- **Do not** close open location periods
- Update `accounts.last_failure_scan_at`
- Schedule retry with backoff; do not spin forever without operator-visible failure history

**A failed scan is not an empty inventory.**

## 4. Observation extraction

From a successful raw inventory:

1. Identify book-like items using versioned extraction rules.  
2. For each, compute `slot_key` stable within that inventory shape (e.g. `inv:{slot}`, `echest:{slot}`, `shulker:{bag}:{slot}`).  
3. Extract `observed_nonce` if present.  
4. Build `normalized_metadata`.  
5. Compute `strict_fingerprint` and `loose_fingerprint`.  
6. Upsert observation on `UNIQUE (scan_id, slot_key)`.

### 4.1 Observation idempotency

Reprocessing the same scan:

- Must not create additional observation rows
- May update mutable resolution fields only via controlled resolver passes
- Must not emit duplicate location events (use event idempotency keys)

If raw inventory content for an existing `scan_id` somehow differs, refuse processing and flag corruption (hash check).

## 5. Inventory comparison model

Location inference compares:

- **Previous successful scan** of the same account (not “last attempt”)
- **Current successful scan**

Let:

- `Prev` = set of resolved canonical item IDs confidently present on account at previous success  
- `Curr` = set of resolved canonical item IDs confidently present now  

Only items with resolution in `{resolved, manually_resolved}` (and optionally `probable` if enabled) participate in automatic location updates.

Unresolved/ambiguous observations never close or open confirmed periods for a specific item.

## 6. Location transition rules

### 6.1 Confirmed presence

When observation `O` resolves to item `I` on account `A` at time `T`:

- If `I` has an open presence period on `A` → no new period; optionally touch `last_seen` denormalized fields / emit `seen` event with idempotency  
- If `I` has an open presence on different account `B` → **do not** silently move; emit `contradiction` or `move_uncertain` pending disappearance confirmation on `B` (see §6.4)  
- If `I` has open unknown gap → close gap at `T`, open presence on `A` with `start_reason=observed`, `certainty=confirmed`  
- If `I` has no open period → open presence on `A`

### 6.2 Disappearance

Item `I` was in `Prev` (open on `A`) and is not in `Curr` after a **successful** scan of `A` at time `T`:

- Close presence period on `A` with `ended_at=T`, `end_reason=disappeared`
- Open an **unknown-location gap** unless a confirmed destination exists in the same processing epoch
- Emit `disappeared` then `unknown_started` events

Never treat missing from a failed scan as disappearance.

### 6.3 Confirmed movement A → B

Only when **all** hold:

1. Successful scan of `A` shows `I` absent (disappearance closed).  
2. Successful scan of `B` shows `I` present.  
3. Identity of both observations is resolved to the same `I` with sufficient confidence.  
4. No other clone-family member equally explains the sighting on `B` unresolved.  
5. Timing is compatible: `T_absent_A` and `T_present_B` ordering makes sense (allow either order depending on scan schedule, but record uncertainty if scans are far apart).

Then:

- End unknown gap if any  
- Ensure presence on `B` open  
- Emit `move_confirmed` with both scan references  
- Set period certainties accordingly

**Not sufficient for confirmed move:**

- Saw similar book on `B` after absence on `A` without resolving identity  
- Nonce match alone inside a duplicate-nonce family  
- Import claim without observational confirmation (imports use `import_presence` / probable)

### 6.4 Uncertain movement / timing uncertainty

Emit `move_uncertain` when:

- Presence on `B` appears while open presence on `A` still exists (scan ordering / delay)
- Absence on `A` and presence on `B` exist but clone family has multiple candidates
- Large time gap between relevant scans exceeds `move_certainty_max_gap` setting

Uncertain events must not be displayed as definitive transfers on the item page.

### 6.5 Concurrent / contradictory observations

Examples:

- Two successful scans (possibly near-simultaneous across accounts) imply presence of the same non-clone item on two accounts  
- Manual history conflicts with scan evidence  

Actions:

- Mark affected periods `certainty=contradicted`
- Keep raw observations intact
- Queue for operator review
- Do not autodelete evidence

### 6.6 Clone-family multiplicity

When processing account `A` for nonce family `F`:

- Expected members on `A` = family items with open confirmed/probable presence on `A`
- Observed matching slots = observations with that nonce (and compatible fingerprint)
- Match expected↔observed using continuity rules in `ITEM_IDENTITY.md`
- Unmatched expected → disappearance
- Unmatched observed → ambiguous/unresolved new sightings (not auto-assigned to items currently open elsewhere)

## 7. Unknown-location gaps

Unknown gaps are first-class timeline rows:

- `account_id NULL`
- `is_unknown_gap = true`
- `start_reason` typically `disappeared` or `manual`
- Closed when item observed again somewhere with resolution

UI must render gaps explicitly (e.g. “Unknown location from … to …”).

## 8. False movement prevention checklist

Before creating `move_confirmed`, verify:

- [ ] Source absence based on successful scan  
- [ ] Destination presence based on successful scan  
- [ ] Same canonical item ID on both sides  
- [ ] Item not `merged_away`  
- [ ] Clone-family ambiguity checks passed  
- [ ] Event idempotency key not already present  
- [ ] Not merely “last seen A, next seen B” without absence confirmation if settings require it  

Default MVP policy: **require source absence confirmation** for confirmed moves.

## 9. Reprocessing rules

`process_scan` may run multiple times for one scan:

1. Load scan; abort if not `success`  
2. Verify `raw_inventory_hash`  
3. Upsert observations by `(scan_id, slot_key)`  
4. Run resolver for observations not `manually_resolved` (configurable)  
5. Recompute location effects using idempotent event keys:

```text
loc:{item_id}:{event_type}:{scan_id}:{observation_id?}
```

6. Mark `processing_status=processed`

## 10. Scheduling & backoff

| Event | Behavior |
|---|---|
| Success | `next_scan_at = now + interval` |
| Transient failure | exponential backoff capped; still visible in failure UI |
| Persistent auth failure | disable auto-scan or flag account `needs_attention` (setting) |
| Manual scan | does not necessarily reset schedule unfairly; update `next_scan_at` reasonably |

## 11. What counts as “currently known location”

Display priority:

1. Open confirmed presence period’s account  
2. Else open probable presence (labeled probable)  
3. Else unknown (explicit)  
4. Never show “last seen account” as current without labeling it **last observed** if the period is closed

Item page should show both **current known location** and **last confirmed observation**.

## 12. Scan history UI requirements

Show:

- Time, account, status, duration  
- Error code/message on failure  
- Item count on success  
- Link to observations  
- Processing status  
- Distinguishing badge: failure ≠ empty

## 13. Test matrix (scanning / location)

1. Failed scan leaves open periods unchanged  
2. Successful empty inventory closes open periods into unknown gaps  
3. Reprocess same scan ⇒ same observation IDs / no duplicate events  
4. Item leaves A (success) then appears B (success) ⇒ confirmed move once  
5. Item appears B before A absence confirmed ⇒ uncertain/contradiction path, not silent confirmed move  
6. Duplicate nonce family: A holds item1; B sees matching book while item1 still open on A ⇒ do not assign to item1 automatically  
7. Two matching books on one account map to two family members without creating extra moves  
8. Disabled account stops new scans; history remains  
9. Concurrent processing of same scan job is safe (unique constraints / row locks)
