/** Human-readable live-signal copy for Hypixel watch events. */

import type { InventoryChangeItem } from "./inventory/inventory-diff.js";
import { formatInventoryChangeLabel } from "./inventory/inventory-diff.js";

export type LiveSignalKind = "came_online" | "went_offline" | "inventory_changed" | "scanned";

export type { InventoryChangeItem };
export { formatInventoryChangeLabel };

/** Crazy → Crazy's, Iris → Iris' */
export function possessiveName(username: string): string {
  const name = username.trim();
  if (!name) return "Someone's";
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

function formatChangeClause(change: InventoryChangeItem): string {
  const label = formatInventoryChangeLabel(change);
  if (change.direction === "gained") return `gained ${label}`;
  if (change.direction === "lost") return `lost ${label}`;
  return `updated ${label}`;
}

export function describeLiveSignal(input: {
  kind: LiveSignalKind | string;
  mcUsername: string;
  detail?: string | null;
  changes?: InventoryChangeItem[] | null;
}): string {
  const who = input.mcUsername.trim() || "Unknown";
  const owned = possessiveName(who);
  switch (input.kind) {
    case "inventory_changed": {
      if (input.changes && input.changes.length > 0) {
        const shown = input.changes.slice(0, 4).map(formatChangeClause);
        const more =
          input.changes.length > 4 ? `; +${input.changes.length - 4} more` : "";
        return `${who} ${shown.join("; ")}${more}`;
      }
      return input.detail
        ? `${owned} inventory changed · ${input.detail}`
        : `${owned} inventory changed`;
    }
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
