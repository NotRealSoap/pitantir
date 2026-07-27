import type { Account } from "./repository.js";
import { notesIndicate140er } from "./notes-labels.js";
import { HYPIXEL_140ER_INTERVAL_SECONDS } from "@pitantir/shared/inventory";

/** Treat PitPal lobby sightings as fresh within this window. */
export const PITPAL_PRESENCE_FRESH_MS = 90_000;
/** While effectively online (non-140er), scan at least this often. */
export const PRESENCE_HOT_INTERVAL_SECONDS = 300;
/** Job priority bump while effectively online (lower runs sooner). */
export const PRESENCE_HOT_PRIORITY = 35;
/** PitPanda lastseen within this window counts as a weak online hint. */
export const PITPANDA_LASTSEEN_FRESH_MS = 5 * 60_000;
/**
 * 140er-labelled accounts are not auto-scanned on Hypixel (PitPal presence only).
 * Kept as a park / legacy floor for schedule cursors.
 */
export const PRESENCE_140ER_INTERVAL_SECONDS = HYPIXEL_140ER_INTERVAL_SECONDS;

export type EffectivePresence = {
  /** Show on dashboard / treat as activity hotspot. */
  online: boolean;
  /** PitPal lists them but Hypixel reports offline/unknown. */
  apiOff: boolean;
  /** Soft signal from a fresh PitPal lobby listing. */
  pitpalListed: boolean;
  /** Raw Hypixel flag (may be false while apiOff). */
  hypixelOnline: boolean | null;
  /**
   * When true, online was decided from PitPal only (lobby feed was authoritative).
   * Hypixel alone cannot mark someone online in this mode.
   */
  pitpalAuthoritative: boolean;
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

export type ResolveEffectivePresenceOptions = {
  nowMs?: number;
  pitpalFreshMs?: number;
  /**
   * When true (fresh Tampermonkey lobby feed), PitPal listing is the only
   * online signal. Hypixel API Off / false-online cannot override it.
   * When false/omitted, fall back to PitPal OR Hypixel online.
   */
  pitpalAuthoritative?: boolean;
};

/**
 * Resolve dashboard / hotspot online-ness.
 *
 * Prefer PitPal lobbies as source of truth when the lobby feed is fresh
 * (`pitpalAuthoritative`). Hypixel session flags are unreliable (API Off
 * players look offline while in Pit).
 */
export function resolveEffectivePresence(
  account: Pick<
    Account,
    | "lastHypixelOnline"
    | "lastPitpalLobby"
    | "lastPitpalLocation"
    | "lastPitpalSeenAt"
  >,
  options?: ResolveEffectivePresenceOptions,
): EffectivePresence {
  const nowMs = options?.nowMs ?? Date.now();
  const pitpalFreshMs = options?.pitpalFreshMs ?? PITPAL_PRESENCE_FRESH_MS;
  const pitpalAuthoritative = Boolean(options?.pitpalAuthoritative);

  const pitpalListed =
    Boolean(account.lastPitpalLobby || account.lastPitpalLocation) &&
    pitpalSeenIsFresh(account.lastPitpalSeenAt, pitpalFreshMs, nowMs);

  const hypixelOnline = account.lastHypixelOnline;
  const online = pitpalAuthoritative
    ? pitpalListed
    : pitpalListed || hypixelOnline === true;
  const apiOff = pitpalListed && hypixelOnline !== true;

  return {
    online,
    apiOff,
    pitpalListed,
    hypixelOnline,
    pitpalAuthoritative,
  };
}

export function accountIs140er(
  account: Pick<Account, "notes"> | { notes?: string | null },
): boolean {
  return notesIndicate140er(account.notes);
}

export function effectiveScanIntervalSeconds(
  account: Pick<Account, "scanIntervalSeconds" | "notes"> &
    Parameters<typeof resolveEffectivePresence>[0],
  options?: ResolveEffectivePresenceOptions,
): number {
  const base = Math.max(30, Math.floor(account.scanIntervalSeconds || 3600));
  // 140ers: presence dashboard updates from PitPal only — never auto Hypixel.
  // Interval is parked so any leftover schedule cursor stays cold.
  if (accountIs140er(account)) {
    return Math.max(base, PRESENCE_140ER_INTERVAL_SECONDS);
  }
  if (resolveEffectivePresence(account, options).online) {
    return Math.min(base, PRESENCE_HOT_INTERVAL_SECONDS);
  }
  return base;
}

export function effectiveScanPriority(
  account: Pick<Account, "priority" | "notes"> & Parameters<typeof resolveEffectivePresence>[0],
  options?: ResolveEffectivePresenceOptions,
): number {
  const base = Math.floor(account.priority || 100);
  if (accountIs140er(account)) return base;
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
