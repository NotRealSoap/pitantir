/**
 * Best-effort parsing of PitPanda item payloads.
 *
 * Confirmed real detail shape from GET /api/item/{mongoDocId}:
 * - `_id` — PitPanda Mongo doc id only (fetch key), not a player/item UUID
 * - `owner` — current owner Minecraft player UUID (undashed)
 * - `owners: [{ _id, uuid, time }]` — ownership sightings:
 *   - `uuid` — player Minecraft UUID (the useful identity)
 *   - `_id` — PitPanda’s internal marker for that ownership *event* (dedupe only)
 *   - `time` — when PitPanda recorded that owner sighting
 * - `nonce`, `enchants`, `lives`, `maxLives`, `item`, `lastseen`, …
 *
 * Search list items may omit `owners`; use detail lookup via item `_id`/`id` when missing.
 */

import { coerceInventoryNonce, coerceInventoryUuid, resolveMysticIds } from "../inventory/nonce.js";

function stripMcFormatting(value: string): string {
  return value.replace(/§./g, "").trim();
}

export interface PitPandaOwnerRecord {
  /** Minecraft player UUID (dashed). This is the useful ownership identity. */
  uuid: string;
  seenAt: string;
  /**
   * PitPanda Mongo `_id` for this owners[] *event* row.
   * Internal marker only — not a player UUID, not an item UUID. Used for idempotent import keys.
   */
  pitpandaEventId: string | null;
}

export interface ParsedUpstreamItemFields {
  /**
   * PitPanda Mongo doc id for this item (`_id` / search `id`).
   * Fetch key for GET /api/item/{id} only — not a Minecraft UUID or Pit nonce.
   */
  pitpandaItemId: string | null;
  title: string | null;
  kind: string | null;
  nonce: string | null;
  /** Minecraft item UUID when present in NBT/payload — distinct from PitPanda `_id`. */
  itemUuid: string | null;
  lives: number | null;
  maxLives: number | null;
  customEnchants: Record<string, number> | null;
  lore: string[] | null;
  lastSeenAt: string | null;
  ownerUsername: string | null;
  /** Current owner Minecraft player UUID. */
  ownerUuid: string | null;
  /** Ownership timeline from PitPanda when present (detail endpoint). */
  owners: PitPandaOwnerRecord[];
  tier: number | null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value));
  }
  return null;
}

function asIsoTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed) && Number.isFinite(Number(trimmed))) {
      return asIsoTimestamp(Number(trimmed));
    }
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function normalizeUuidMaybe(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const hex = raw.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return raw.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseEnchantList(value: unknown): Record<string, number> | null {
  if (Array.isArray(value)) {
    const out: Record<string, number> = {};
    for (const entry of value) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      const key = asString(record.key) ?? asString(record.name);
      const level = asNumber(record.level) ?? asNumber(record.lvl);
      if (key && level !== null) out[key] = level;
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const level = asNumber(raw);
      if (level !== null) out[key] = level;
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  return null;
}

/**
 * Parse PitPanda `owners` array into normalized timeline entries (chronological).
 * Identity for each row is `uuid` (player). `_id` is only PitPanda’s event marker.
 * Does not invent history when the array is absent.
 */
export function parsePitPandaOwners(value: unknown): PitPandaOwnerRecord[] {
  if (!Array.isArray(value)) return [];
  const out: PitPandaOwnerRecord[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const rawUuid = asString(record.uuid);
    if (!rawUuid) continue;
    const hex = rawUuid.replace(/-/g, "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hex)) continue;
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const seenAt = asIsoTimestamp(record.time) ?? asIsoTimestamp(record.seenAt);
    if (!seenAt) continue;
    out.push({
      uuid,
      seenAt,
      // Opaque PitPanda event marker — never treat as player/item UUID.
      pitpandaEventId: asString(record._id),
    });
  }
  return out.sort((a, b) => a.seenAt.localeCompare(b.seenAt));
}

function asMongoObjectId(value: unknown): string | null {
  // PitPanda Mongo ids only (item doc or owners[] event). Never a Minecraft UUID.
  // Raw docs use `_id`; dbToItem search rows rename item `_id` → `id`.
  if (typeof value === "string" && /^[a-f0-9]{24}$/i.test(value.trim())) {
    return value.trim().toLowerCase();
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const oid = asString(record.$oid) ?? asString(record.oid);
    if (oid && /^[a-f0-9]{24}$/i.test(oid)) return oid.toLowerCase();
  }
  return null;
}

export function parseUpstreamItemFields(raw: Record<string, unknown>): ParsedUpstreamItemFields {
  const nestedItem =
    raw.item && typeof raw.item === "object" && !Array.isArray(raw.item)
      ? (raw.item as Record<string, unknown>)
      : null;

  const ids = resolveMysticIds(raw);
  const titleRaw =
    asString(nestedItem?.name) ??
    asString(raw.name) ??
    asString(raw.title) ??
    asString(raw.itemName) ??
    asString(raw.displayName);
  const title = titleRaw ? stripMcFormatting(titleRaw) : null;

  const customEnchants =
    parseEnchantList(raw.enchants) ??
    parseEnchantList(raw.customEnchants) ??
    parseEnchantList(raw.t3) ??
    parseEnchantList(raw.enchantments);

  const lore = Array.isArray(raw.lore)
    ? raw.lore.map(String)
    : Array.isArray(raw.description)
      ? raw.description.map(String)
      : Array.isArray(nestedItem?.description)
        ? nestedItem!.description.map(String)
        : null;

  const owners = parsePitPandaOwners(raw.owners);
  const ownerUuid =
    normalizeUuidMaybe(raw.owner) ??
    normalizeUuidMaybe(raw.ownerUuid) ??
    owners.at(-1)?.uuid ??
    null;

  return {
    pitpandaItemId: asMongoObjectId(raw._id) ?? asMongoObjectId(raw.id),
    title,
    kind:
      asString(raw.kind) ??
      asString(raw.type) ??
      asString(raw.itemType) ??
      (title && /bow/i.test(title)
        ? "bow"
        : title && /sword/i.test(title)
          ? "sword"
          : title && /pants|leggings/i.test(title)
            ? "pants"
            : null),
    nonce:
      ids.nonce ??
      coerceInventoryNonce(raw.nonce) ??
      coerceInventoryNonce(raw.Nonce),
    itemUuid: ids.itemUuid ?? coerceInventoryUuid(raw.uuid),
    lives: asNumber(raw.lives),
    maxLives: asNumber(raw.maxLives) ?? asNumber(raw.max_lives),
    customEnchants,
    lore,
    lastSeenAt:
      asIsoTimestamp(raw.lastseen) ??
      asIsoTimestamp(raw.lastSeen) ??
      asIsoTimestamp(raw.last_seen) ??
      asIsoTimestamp(raw.lastseenOffline),
    ownerUsername: asString(raw.ownerName) ?? asString(raw.username) ?? asString(raw.player),
    ownerUuid,
    owners,
    tier: asNumber(raw.tier),
  };
}

/** True when payload already contains usable PitPanda ownership history. */
export function hasEmbeddedOwners(raw: Record<string, unknown>): boolean {
  return parsePitPandaOwners(raw.owners).length > 0;
}
