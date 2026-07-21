import { gunzipSync } from "node:zlib";
import nbt from "prismarine-nbt";
import { coerceInventoryUuid, pickInventoryNonce } from "./nonce.js";

export interface DecodedInventoryItem {
  slot: number | null;
  id: string | null;
  count: number;
  raw: Record<string, unknown>;
}

/**
 * Convert Hypixel Pit signed-byte inventory payloads into decoded NBT item slots.
 * Pit stores inventories as `{ type, data: number[] }` gzipped NBT compounds.
 */
export async function decodePitInventoryPayload(
  payload: unknown,
): Promise<DecodedInventoryItem[]> {
  const bytes = extractByteArray(payload);
  if (!bytes || bytes.length === 0) {
    return [];
  }

  const parsed = await parsePossiblyGzippedNbt(bytes);
  const simplified = nbt.simplify(parsed) as Record<string, unknown>;
  return extractItemsFromSimplified(simplified);
}

function extractByteArray(payload: unknown): Buffer | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const data = record.data ?? record;
  if (typeof data === "string") {
    return Buffer.from(data, "base64");
  }
  if (Array.isArray(data)) {
    return Buffer.from(data.map((value) => {
      const n = Number(value);
      return n < 0 ? n + 256 : n;
    }));
  }
  return null;
}

async function parsePossiblyGzippedNbt(bytes: Buffer): Promise<nbt.NBT> {
  try {
    const { parsed } = await nbt.parse(bytes);
    return parsed;
  } catch {
    const unzipped = gunzipSync(bytes);
    const { parsed } = await nbt.parse(unzipped);
    return parsed;
  }
}

function extractItemsFromSimplified(root: Record<string, unknown>): DecodedInventoryItem[] {
  const lists: unknown[] = [];
  if (Array.isArray(root.i)) lists.push(...root.i);
  if (Array.isArray(root.Items)) lists.push(...root.Items);
  if (Array.isArray(root.items)) lists.push(...root.items);

  // Some inventories wrap further
  if (lists.length === 0) {
    for (const value of Object.values(root)) {
      if (Array.isArray(value) && value.some((entry) => entry && typeof entry === "object")) {
        lists.push(...value);
      }
    }
  }

  const out: DecodedInventoryItem[] = [];
  lists.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const item = entry as Record<string, unknown>;
    const id =
      typeof item.id === "string"
        ? item.id
        : typeof item.id === "number"
          ? String(item.id)
          : null;
    const slot =
      typeof item.Slot === "number"
        ? item.Slot
        : typeof item.slot === "number"
          ? item.slot
          : index;
    const count =
      typeof item.Count === "number"
        ? item.Count
        : typeof item.count === "number"
          ? item.count
          : 1;
    out.push({ slot, id, count, raw: item });
  });
  return out;
}

export function bookFieldsFromNbtItem(item: DecodedInventoryItem): Record<string, unknown> | null {
  const tag =
    item.raw.tag && typeof item.raw.tag === "object"
      ? (item.raw.tag as Record<string, unknown>)
      : {};
  const display =
    tag.display && typeof tag.display === "object"
      ? (tag.display as Record<string, unknown>)
      : {};
  const extra =
    tag.ExtraAttributes && typeof tag.ExtraAttributes === "object"
      ? (tag.ExtraAttributes as Record<string, unknown>)
      : tag.extraAttributes && typeof tag.extraAttributes === "object"
        ? (tag.extraAttributes as Record<string, unknown>)
        : {};

  const idLower = (item.id ?? "").toLowerCase();
  const title =
    stripMcFormatting(
      typeof tag.title === "string"
        ? tag.title
        : typeof display.Name === "string"
          ? display.Name
          : null,
    ) ?? null;
  const author = typeof tag.author === "string" ? tag.author : null;
  const pages = normalizePages(tag.pages);
  const nonce = pickInventoryNonce(
    extra.nonce,
    extra.Nonce,
    tag.nonce,
    tag.Nonce,
  );
  const itemUuid =
    coerceInventoryUuid(extra.uuid) ??
    coerceInventoryUuid(extra.UUID) ??
    coerceInventoryUuid(extra.Uuid);

  const lore =
    Array.isArray(display.Lore)
      ? display.Lore.filter((line): line is string => typeof line === "string").map(
          (line) => stripMcFormatting(line) ?? line,
        )
      : undefined;

  const customEnchants = normalizeCustomEnchants(extra.CustomEnchants ?? extra.customEnchants);

  const isBook =
    idLower.includes("book") ||
    idLower.includes("writable_book") ||
    idLower === "386" ||
    idLower === "387" ||
    author !== null ||
    pages !== null;

  // Pitantir tracks nonce-bearing mystics (and books). Skip vanilla junk without a nonce.
  if (!isBook && nonce === null) {
    return null;
  }

  return {
    id: item.id,
    type: item.id,
    kind: isBook ? "book" : "mystic",
    title,
    author,
    pages: pages ?? undefined,
    pageCount: pages ? pages.split("\n").length : undefined,
    lore: lore && lore.length > 0 ? lore : undefined,
    customEnchants: customEnchants ?? undefined,
    nonce: nonce ?? undefined,
    itemUuid: itemUuid ?? undefined,
    lives: coerceLives(extra.Lives ?? extra.lives) ?? undefined,
    maxLives: coerceLives(extra.MaxLives ?? extra.maxLives) ?? undefined,
    generation: typeof tag.generation === "number" ? String(tag.generation) : undefined,
    hypixelExtraAttributes: Object.keys(extra).length > 0 ? extra : undefined,
  };
}

function coerceLives(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value));
  }
  return null;
}

function normalizeCustomEnchants(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = Math.trunc(raw);
    } else if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
      out[key] = Math.trunc(Number(raw));
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function normalizePages(pages: unknown): string | null {
  if (typeof pages === "string") return stripMcFormatting(pages);
  if (!Array.isArray(pages)) return null;
  return pages
    .map((page) => (typeof page === "string" ? stripMcFormatting(page) : String(page)))
    .join("\n");
}

export function stripMcFormatting(value: string | null): string | null {
  if (value === null) return null;
  return value.replace(/§./g, "").trim();
}
