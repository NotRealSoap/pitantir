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
