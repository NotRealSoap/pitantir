/** PitPal furry-stash notes that mark presence-only / slow Hypixel indexing. */
export function notesIndicate140er(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return /\b140ers?\b/i.test(notes) || /140er/i.test(notes);
}
