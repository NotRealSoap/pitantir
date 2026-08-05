/** PitPal furry-stash notes that mark presence-only / slow Hypixel indexing. */
export function notesIndicate140er(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return /\b140ers?\b/i.test(notes) || /140er/i.test(notes);
}

/** Operator tag: prefer ~5m Hypixel cadence on the API board. */
export function notesIndicateHighActivity(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return /\bhigh[\s_-]*activity\b/i.test(notes);
}

/** Notes set by furry-stashes Tampermonkey sync (`furry-stashes` / `furry-stashes: …`). */
export function notesIndicateFurryStash(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return /\bfurry-stashes\b/i.test(notes);
}
