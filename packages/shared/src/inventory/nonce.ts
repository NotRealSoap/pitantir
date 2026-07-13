/**
 * Pit mystic nonces are usually ints in ExtraAttributes (often `nonce` / `Nonce`).
 * Identity stores them as strings, so coerce here.
 */
export function coerceInventoryNonce(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return null;
}

export function pickInventoryNonce(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const nonce = coerceInventoryNonce(candidate);
    if (nonce !== null) return nonce;
  }
  return null;
}

/** Item UUID from ExtraAttributes (distinct from mystic Nonce). */
export function coerceInventoryUuid(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

/**
 * Resolve mystic Nonce + item UUID from a stored raw item / ExtraAttributes blob.
 * Prefer explicit top-level fields, then ExtraAttributes — never conflate uuid into nonce.
 */
export function resolveMysticIds(rawItem: Record<string, unknown>): {
  nonce: string | null;
  itemUuid: string | null;
} {
  const extra =
    rawItem.hypixelExtraAttributes &&
    typeof rawItem.hypixelExtraAttributes === "object" &&
    !Array.isArray(rawItem.hypixelExtraAttributes)
      ? (rawItem.hypixelExtraAttributes as Record<string, unknown>)
      : rawItem.ExtraAttributes &&
          typeof rawItem.ExtraAttributes === "object" &&
          !Array.isArray(rawItem.ExtraAttributes)
        ? (rawItem.ExtraAttributes as Record<string, unknown>)
        : {};

  const nonce = pickInventoryNonce(rawItem.nonce, rawItem.Nonce, extra.nonce, extra.Nonce);
  const itemUuid =
    coerceInventoryUuid(rawItem.itemUuid) ??
    coerceInventoryUuid(rawItem.uuid) ??
    coerceInventoryUuid(extra.uuid) ??
    coerceInventoryUuid(extra.UUID) ??
    coerceInventoryUuid(extra.Uuid);

  return { nonce, itemUuid };
}
