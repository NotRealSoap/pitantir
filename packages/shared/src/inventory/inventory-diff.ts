import { extractBookSlots } from "./extract.js";
import { resolveMysticIds } from "./nonce.js";
import {
  formatPitBearLine,
  isGemmed,
  resolveMysticLives,
} from "./mystic-display.js";

export type InventoryChangeDirection = "gained" | "lost" | "updated";

/** One concrete mystic move/update within an inventory change signal. */
export interface InventoryChangeItem {
  direction: InventoryChangeDirection;
  nonce: string | null;
  title: string;
  summary: string | null;
  slotKey: string | null;
  previousSummary?: string | null;
  previousSlotKey?: string | null;
}

export interface InventoryDiff {
  gained: InventoryChangeItem[];
  lost: InventoryChangeItem[];
  updated: InventoryChangeItem[];
  /** Flat list: gained, then lost, then updated. */
  changes: InventoryChangeItem[];
}

function cleanTitle(value: unknown): string {
  if (typeof value !== "string") return "Mystic item";
  const cleaned = value.replace(/§./g, "").trim();
  return cleaned || "Mystic item";
}

function summaryFromRaw(rawItem: Record<string, unknown>): string | null {
  const lives = resolveMysticLives(rawItem);
  const lore = Array.isArray(rawItem.lore) ? rawItem.lore.map(String) : null;
  const customEnchants =
    rawItem.customEnchants &&
    typeof rawItem.customEnchants === "object" &&
    !Array.isArray(rawItem.customEnchants)
      ? (rawItem.customEnchants as Record<string, number>)
      : null;
  const hypixelExtraAttributes =
    rawItem.hypixelExtraAttributes &&
    typeof rawItem.hypixelExtraAttributes === "object" &&
    !Array.isArray(rawItem.hypixelExtraAttributes)
      ? (rawItem.hypixelExtraAttributes as Record<string, unknown>)
      : null;
  const line = formatPitBearLine({
    lives: lives.lives,
    maxLives: lives.maxLives,
    lore,
    customEnchants,
    gemmed: isGemmed({ lore, customEnchants, hypixelExtraAttributes }),
  }).trim();
  return line || null;
}

function itemFromSlot(
  direction: InventoryChangeDirection,
  slot: { slotKey: string; rawItem: Record<string, unknown> },
  previous?: { slotKey: string; rawItem: Record<string, unknown> },
): InventoryChangeItem {
  const nonce = resolveMysticIds(slot.rawItem).nonce;
  return {
    direction,
    nonce,
    title: cleanTitle(slot.rawItem.title),
    summary: summaryFromRaw(slot.rawItem),
    slotKey: slot.slotKey,
    previousSummary: previous ? summaryFromRaw(previous.rawItem) : undefined,
    previousSlotKey: previous ? previous.slotKey : undefined,
  };
}

function signature(slot: { slotKey: string; rawItem: Record<string, unknown> }): string {
  return [
    cleanTitle(slot.rawItem.title),
    summaryFromRaw(slot.rawItem) ?? "",
    slot.slotKey,
  ].join("|");
}

/** Diff mystic slots by nonce across two raw Hypixel inventory payloads. */
export function diffInventoriesByNonce(
  previousRaw: Record<string, unknown>,
  currentRaw: Record<string, unknown>,
): InventoryDiff {
  const prevSlots = extractBookSlots(previousRaw);
  const currSlots = extractBookSlots(currentRaw);

  const prevByNonce = new Map<string, { slotKey: string; rawItem: Record<string, unknown> }>();
  const currByNonce = new Map<string, { slotKey: string; rawItem: Record<string, unknown> }>();

  for (const slot of prevSlots) {
    const nonce = resolveMysticIds(slot.rawItem).nonce;
    if (nonce) prevByNonce.set(nonce, slot);
  }
  for (const slot of currSlots) {
    const nonce = resolveMysticIds(slot.rawItem).nonce;
    if (nonce) currByNonce.set(nonce, slot);
  }

  const gained: InventoryChangeItem[] = [];
  const lost: InventoryChangeItem[] = [];
  const updated: InventoryChangeItem[] = [];

  for (const [nonce, slot] of currByNonce) {
    const previous = prevByNonce.get(nonce);
    if (!previous) {
      gained.push(itemFromSlot("gained", slot));
      continue;
    }
    if (signature(previous) !== signature(slot)) {
      updated.push(itemFromSlot("updated", slot, previous));
    }
  }
  for (const [nonce, slot] of prevByNonce) {
    if (!currByNonce.has(nonce)) {
      lost.push(itemFromSlot("lost", slot));
    }
  }

  return {
    gained,
    lost,
    updated,
    changes: [...gained, ...lost, ...updated],
  };
}

/** Short label for one change, e.g. "Tier III Sword · 11/18 Lifesteal 3 (nonce 123)". */
export function formatInventoryChangeLabel(change: InventoryChangeItem): string {
  const parts = [change.title];
  if (change.direction === "updated" && change.previousSummary && change.summary) {
    if (change.previousSummary !== change.summary) {
      parts.push(`${change.previousSummary} → ${change.summary}`);
    } else if (change.summary) {
      parts.push(change.summary);
    }
  } else if (change.summary) {
    parts.push(change.summary);
  }
  if (
    change.direction === "updated" &&
    change.previousSlotKey &&
    change.slotKey &&
    change.previousSlotKey !== change.slotKey
  ) {
    parts.push(`${change.previousSlotKey} → ${change.slotKey}`);
  }
  if (change.nonce) parts.push(`nonce ${change.nonce}`);
  return parts.join(" · ");
}

/** Human detail for live events / signal pills. */
export function formatInventoryChangeDetail(diff: InventoryDiff, options?: { maxItems?: number }): string {
  const maxItems = options?.maxItems ?? 6;
  if (diff.changes.length === 0) {
    return "same mystic nonces — slot/meta changed";
  }
  const shown = diff.changes.slice(0, maxItems);
  const parts = shown.map((change) => {
    const label = formatInventoryChangeLabel(change);
    if (change.direction === "gained") return `gained ${label}`;
    if (change.direction === "lost") return `lost ${label}`;
    return `updated ${label}`;
  });
  const remaining = diff.changes.length - shown.length;
  if (remaining > 0) parts.push(`+${remaining} more`);
  return parts.join("; ");
}
