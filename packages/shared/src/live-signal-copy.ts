/** Human-readable live-signal copy for Hypixel watch events. */

export type LiveSignalKind = "came_online" | "went_offline" | "inventory_changed" | "scanned";

/** Crazy → Crazy's, Iris → Iris' */
export function possessiveName(username: string): string {
  const name = username.trim();
  if (!name) return "Someone's";
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

export function describeLiveSignal(input: {
  kind: LiveSignalKind | string;
  mcUsername: string;
  detail?: string | null;
}): string {
  const who = input.mcUsername.trim() || "Unknown";
  const owned = possessiveName(who);
  switch (input.kind) {
    case "inventory_changed":
      return input.detail
        ? `${owned} inventory changed · ${input.detail}`
        : `${owned} inventory changed`;
    case "came_online":
      return input.detail ? `${who} came online · ${input.detail}` : `${who} came online`;
    case "went_offline":
      return `${who} went offline`;
    case "scanned":
      return input.detail ? `Scanned ${who} · ${input.detail}` : `Scanned ${who}`;
    default:
      return input.detail ? `${who}: ${input.detail}` : who;
  }
}

/** Summarize mystic nonce set differences for a live inventory-change detail. */
export function summarizeNonceDelta(previous: string[], current: string[]): string {
  const prev = new Set(previous);
  const curr = new Set(current);
  let added = 0;
  let removed = 0;
  for (const nonce of curr) {
    if (!prev.has(nonce)) added += 1;
  }
  for (const nonce of prev) {
    if (!curr.has(nonce)) removed += 1;
  }
  const parts: string[] = [];
  if (added > 0) parts.push(`+${added} mystic${added === 1 ? "" : "s"}`);
  if (removed > 0) parts.push(`-${removed} mystic${removed === 1 ? "" : "s"}`);
  if (parts.length === 0) {
    return `${current.length} mystic slot${current.length === 1 ? "" : "s"} (same nonces, other fields changed)`;
  }
  return `${parts.join(" / ")} · now ${current.length}`;
}
