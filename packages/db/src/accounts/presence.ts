import type { Account } from "./repository.js";

/** Treat PitPal lobby sightings as fresh within this window. */
export const PITPAL_PRESENCE_FRESH_MS = 90_000;
/** While effectively online, scan at least this often. */
export const PRESENCE_HOT_INTERVAL_SECONDS = 180;
/** Job priority bump while effectively online (lower runs sooner). */
export const PRESENCE_HOT_PRIORITY = 35;
/** PitPanda lastseen within this window counts as a weak online hint. */
export const PITPANDA_LASTSEEN_FRESH_MS = 5 * 60_000;

export type EffectivePresence = {
  /** Show on dashboard / treat as activity hotspot. */
  online: boolean;
  /** PitPal lists them but Hypixel reports offline/unknown. */
  apiOff: boolean;
  /** Soft signal from a fresh PitPal lobby listing. */
  pitpalListed: boolean;
  /** Raw Hypixel flag (may be false while apiOff). */
  hypixelOnline: boolean | null;
};

function pitpalSeenIsFresh(
  seenAt: Date | string | null | undefined,
  maxAgeMs: number = PITPAL_PRESENCE_FRESH_MS,
  nowMs: number = Date.now(),
): boolean {
  if (!seenAt) return false;
  const at = typeof seenAt === "string" ? Date.parse(seenAt) : seenAt.getTime();
  if (!Number.isFinite(at)) return false;
  return nowMs - at <= maxAgeMs;
}

/**
 * PitPal lobby listing is a soft online signal while the Tampermonkey feed is fresh.
 * Hypixel may still report offline when API session is hidden → apiOff.
 */
export function resolveEffectivePresence(
  account: Pick<
    Account,
    | "lastHypixelOnline"
    | "lastPitpalLobby"
    | "lastPitpalLocation"
    | "lastPitpalSeenAt"
  >,
  options?: {
    nowMs?: number;
    pitpalFreshMs?: number;
  },
): EffectivePresence {
  const nowMs = options?.nowMs ?? Date.now();
  const pitpalFreshMs = options?.pitpalFreshMs ?? PITPAL_PRESENCE_FRESH_MS;

  const pitpalListed =
    Boolean(account.lastPitpalLobby || account.lastPitpalLocation) &&
    pitpalSeenIsFresh(account.lastPitpalSeenAt, pitpalFreshMs, nowMs);

  const hypixelOnline = account.lastHypixelOnline;
  const online = pitpalListed || hypixelOnline === true;
  const apiOff = pitpalListed && hypixelOnline !== true;

  return {
    online,
    apiOff,
    pitpalListed,
    hypixelOnline,
  };
}

export function effectiveScanIntervalSeconds(
  account: Pick<Account, "scanIntervalSeconds"> &
    Parameters<typeof resolveEffectivePresence>[0],
  options?: Parameters<typeof resolveEffectivePresence>[1],
): number {
  const base = Math.max(30, Math.floor(account.scanIntervalSeconds || 3600));
  if (resolveEffectivePresence(account, options).online) {
    return Math.min(base, PRESENCE_HOT_INTERVAL_SECONDS);
  }
  return base;
}

export function effectiveScanPriority(
  account: Pick<Account, "priority"> & Parameters<typeof resolveEffectivePresence>[0],
  options?: Parameters<typeof resolveEffectivePresence>[1],
): number {
  const base = Math.floor(account.priority || 100);
  if (resolveEffectivePresence(account, options).online) {
    return Math.min(base, PRESENCE_HOT_PRIORITY);
  }
  return base;
}

/** Soonest we should re-check a hotspot (with light jitter to avoid re-clustering). */
export function hotNextScanAt(from: Date = new Date(), salt = 0): Date {
  const jitterMs = Math.abs(salt % 60_000);
  return new Date(from.getTime() + jitterMs);
}
