import type { ExtractedBookSlot } from "./types.js";
import { resolveMysticIds } from "./nonce.js";
import { resolveMysticLives } from "./mystic-display.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeTrackedItem(item: Record<string, unknown>): boolean {
  const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
  const id = typeof item.id === "string" ? item.id.toLowerCase() : "";
  if (
    type.includes("book") ||
    id.includes("book") ||
    id.includes("writable_book") ||
    id === "386" ||
    id === "387"
  ) {
    return true;
  }
  // Mystic gear and other tracked Pit items are keyed by nonce (top-level or ExtraAttributes).
  if (resolveMysticIds(item).nonce !== null) {
    return true;
  }
  return (
    typeof item.author === "string" ||
    typeof item.pages === "string" ||
    Array.isArray(item.pages)
  );
}

function normalizeRawItem(item: Record<string, unknown>): Record<string, unknown> {
  const pages = Array.isArray(item.pages)
    ? item.pages.map(String).join("\n")
    : typeof item.pages === "string"
      ? item.pages
      : undefined;

  const lore = Array.isArray(item.lore) ? item.lore.map(String) : undefined;

  const customEnchants =
    item.customEnchants && typeof item.customEnchants === "object" && !Array.isArray(item.customEnchants)
      ? (item.customEnchants as Record<string, unknown>)
      : undefined;

  const ids = resolveMysticIds(item);
  const livesResolved = resolveMysticLives(item);
  const hypixelExtraAttributes =
    item.hypixelExtraAttributes &&
    typeof item.hypixelExtraAttributes === "object" &&
    !Array.isArray(item.hypixelExtraAttributes)
      ? item.hypixelExtraAttributes
      : undefined;

  return {
    title: typeof item.title === "string" ? item.title : undefined,
    author: typeof item.author === "string" ? item.author : undefined,
    pages,
    pageCount:
      typeof item.pageCount === "number"
        ? item.pageCount
        : Array.isArray(item.pages)
          ? item.pages.length
          : undefined,
    lore,
    customEnchants,
    kind: typeof item.kind === "string" ? item.kind : undefined,
    nonce: ids.nonce ?? undefined,
    itemUuid: ids.itemUuid ?? undefined,
    lives: livesResolved.lives ?? undefined,
    maxLives: livesResolved.maxLives ?? undefined,
    generation: typeof item.generation === "string" ? item.generation : undefined,
    type: typeof item.type === "string" ? item.type : typeof item.id === "string" ? item.id : undefined,
    hypixelExtraAttributes,
  };
}

function slotSuffix(entry: Record<string, unknown>, index: number): string {
  if (typeof entry.slot === "number" || typeof entry.slot === "string") {
    return String(entry.slot);
  }
  if (typeof entry.slotKey === "string") {
    return entry.slotKey;
  }
  return String(index);
}

function extractFromContainer(
  prefix: string,
  entries: unknown[],
  out: ExtractedBookSlot[],
): void {
  entries.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const bag =
      typeof entry.bag === "string"
        ? entry.bag
        : typeof entry.shulker === "string"
          ? entry.shulker
          : null;
    const item = isRecord(entry.item) ? entry.item : entry;
    if (!looksLikeTrackedItem(item)) return;
    if (entry.item === null) return;

    const key = bag
      ? `${prefix}:${bag}:${slotSuffix(entry, index)}`
      : `${prefix}:${slotSuffix(entry, index)}`;
    out.push({ slotKey: key, rawItem: normalizeRawItem(item) });
  });
}

/**
 * Extract tracked mystic/book items from a successful raw inventory payload.
 * Supports:
 * - `{ inventory: [...], ender_chest: [...] }`
 * - `{ containers: [{ name, slots: [...] }] }`
 * - `{ slots: [...] }` (treated as inv)
 */
export function extractBookSlots(rawInventory: Record<string, unknown>): ExtractedBookSlot[] {
  const out: ExtractedBookSlot[] = [];

  if (Array.isArray(rawInventory.inventory)) {
    extractFromContainer("inv", rawInventory.inventory, out);
  }
  if (Array.isArray(rawInventory.ender_chest)) {
    extractFromContainer("echest", rawInventory.ender_chest, out);
  }
  if (Array.isArray(rawInventory.enderChest)) {
    extractFromContainer("echest", rawInventory.enderChest, out);
  }
  if (Array.isArray(rawInventory.slots)) {
    extractFromContainer("inv", rawInventory.slots, out);
  }
  if (Array.isArray(rawInventory.containers)) {
    for (const container of rawInventory.containers) {
      if (!isRecord(container) || !Array.isArray(container.slots)) continue;
      const name =
        typeof container.name === "string"
          ? container.name
          : typeof container.id === "string"
            ? container.id
            : "bag";
      extractFromContainer(name, container.slots, out);
    }
  }

  // Deduplicate by slot_key (last wins) to stay deterministic.
  const byKey = new Map<string, ExtractedBookSlot>();
  for (const slot of out) {
    byKey.set(slot.slotKey, slot);
  }
  return [...byKey.values()].sort((a, b) => a.slotKey.localeCompare(b.slotKey));
}
