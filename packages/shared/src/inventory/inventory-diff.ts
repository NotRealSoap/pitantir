import { extractBookSlots } from "./extract.js";
import { resolveMysticIds } from "./nonce.js";
import {
  formatPitBearLine,
  isGemmed,
  resolveMysticLives,
} from "./mystic-display.js";
import { pitMaterialDef, type PitMaterialKey } from "./pit-materials.js";

export type InventoryChangeDirection = "gained" | "lost" | "updated";

/** One concrete mystic/material move/update within an inventory change signal. */
export interface InventoryChangeItem {
  direction: InventoryChangeDirection;
  nonce: string | null;
  title: string;
  summary: string | null;
  slotKey: string | null;
  previousSummary?: string | null;
  previousSlotKey?: string | null;
  /** Absolute quantity delta for stackable Pit materials (e.g. +12 / -3). */
  quantityDelta?: number | null;
  materialKey?: PitMaterialKey | null;
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

function isMaterialSlot(rawItem: Record<string, unknown>): boolean {
  return rawItem.kind === "material" || typeof rawItem.materialKey === "string";
}

function materialKeyOf(rawItem: Record<string, unknown>): PitMaterialKey | null {
  if (typeof rawItem.materialKey === "string") {
    return rawItem.materialKey as PitMaterialKey;
  }
  return null;
}

function countOf(rawItem: Record<string, unknown>): number {
  if (typeof rawItem.count === "number" && Number.isFinite(rawItem.count)) {
    return Math.max(0, Math.trunc(rawItem.count));
  }
  return 1;
}

/** Aggregate stackable Pit materials across all containers. */
export function aggregateMaterialCounts(
  rawInventory: Record<string, unknown>,
): Map<PitMaterialKey, { title: string; count: number }> {
  const totals = new Map<PitMaterialKey, { title: string; count: number }>();
  for (const slot of extractBookSlots(rawInventory)) {
    if (!isMaterialSlot(slot.rawItem)) continue;
    const key = materialKeyOf(slot.rawItem);
    if (!key) continue;
    const title =
      typeof slot.rawItem.title === "string" && slot.rawItem.title.trim()
        ? cleanTitle(slot.rawItem.title)
        : pitMaterialDef(key).title;
    const prev = totals.get(key);
    const nextCount = (prev?.count ?? 0) + countOf(slot.rawItem);
    totals.set(key, { title: prev?.title ?? title, count: nextCount });
  }
  return totals;
}

function diffMaterialStacks(
  previousRaw: Record<string, unknown>,
  currentRaw: Record<string, unknown>,
): { gained: InventoryChangeItem[]; lost: InventoryChangeItem[] } {
  const prev = aggregateMaterialCounts(previousRaw);
  const curr = aggregateMaterialCounts(currentRaw);
  const keys = new Set<PitMaterialKey>([...prev.keys(), ...curr.keys()]);
  const gained: InventoryChangeItem[] = [];
  const lost: InventoryChangeItem[] = [];

  for (const key of keys) {
    const before = prev.get(key)?.count ?? 0;
    const after = curr.get(key)?.count ?? 0;
    if (before === after) continue;
    const title =
      curr.get(key)?.title ?? prev.get(key)?.title ?? pitMaterialDef(key).title;
    const delta = after - before;
    const summary = `${delta > 0 ? "+" : ""}${delta} (${before} → ${after})`;
    const item: InventoryChangeItem = {
      direction: delta > 0 ? "gained" : "lost",
      nonce: null,
      title,
      summary,
      slotKey: null,
      quantityDelta: delta,
      materialKey: key,
    };
    if (delta > 0) gained.push(item);
    else lost.push(item);
  }

  return { gained, lost };
}

/**
 * Same-nonce but different max lives = fundamentally different mystic.
 * Treat as lost(previous) + gained(current), not a quiet "updated".
 */
function maxLivesChanged(
  previous: { rawItem: Record<string, unknown> },
  current: { rawItem: Record<string, unknown> },
): boolean {
  const prevMax = resolveMysticLives(previous.rawItem).maxLives;
  const currMax = resolveMysticLives(current.rawItem).maxLives;
  if (prevMax === null || currMax === null) return false;
  return prevMax !== currMax;
}

/** Diff mystic slots by nonce + stackable Pit materials across two raw inventories. */
export function diffInventoriesByNonce(
  previousRaw: Record<string, unknown>,
  currentRaw: Record<string, unknown>,
): InventoryDiff {
  const prevSlots = extractBookSlots(previousRaw).filter((slot) => !isMaterialSlot(slot.rawItem));
  const currSlots = extractBookSlots(currentRaw).filter((slot) => !isMaterialSlot(slot.rawItem));

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
    if (maxLivesChanged(previous, slot)) {
      // Max lives cannot change on the same physical mystic — treat as replace.
      lost.push(itemFromSlot("lost", previous));
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

  const materials = diffMaterialStacks(previousRaw, currentRaw);
  gained.push(...materials.gained);
  lost.push(...materials.lost);

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
export function formatInventoryChangeDetail(
  diff: InventoryDiff,
  options?: { maxItems?: number },
): string {
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
