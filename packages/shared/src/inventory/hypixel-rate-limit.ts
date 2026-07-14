/** Hypixel API rate-limit helpers (response headers + scan pacing). */

export interface HypixelRateLimitSnapshot {
  /** Max requests allowed in the current window for this key. */
  limit: number;
  /** Requests still available before reset. */
  remaining: number;
  /** Seconds until the window resets (from Hypixel at observe time). */
  resetSeconds: number;
  /** ISO timestamp when headers were read. */
  observedAt: string;
  /** How this snapshot was collected. */
  source: "scan" | "probe";
  /**
   * Best-effort estimate of the full window length in seconds.
   * Hypixel often uses ~5 minutes (300s) for 300-limit keys.
   */
  windowSeconds: number;
}

export interface HypixelRateLimitHeaders {
  limit: number;
  remaining: number;
  resetSeconds: number;
}

function headerNumber(headers: Headers, names: string[]): number | null {
  for (const name of names) {
    const raw = headers.get(name);
    if (raw == null || raw.trim() === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/**
 * Parse Hypixel RateLimit-* headers (case-insensitive via Fetch Headers).
 * Returns null when headers are missing.
 */
export function parseHypixelRateLimitHeaders(headers: Headers): HypixelRateLimitHeaders | null {
  const limit = headerNumber(headers, ["RateLimit-Limit", "ratelimit-limit"]);
  const remaining = headerNumber(headers, ["RateLimit-Remaining", "ratelimit-remaining"]);
  const resetSeconds = headerNumber(headers, ["RateLimit-Reset", "ratelimit-reset"]);
  if (limit == null || remaining == null || resetSeconds == null) return null;
  return { limit, remaining, resetSeconds };
}

/**
 * Estimate the full rate-limit window length.
 * When remaining is near the limit, Reset ≈ full window.
 */
export function estimateHypixelWindowSeconds(
  limit: number,
  resetSeconds: number,
  remaining: number,
  previousWindowSeconds?: number | null,
): number {
  if (remaining >= Math.max(0, limit - 2)) {
    return Math.max(60, Math.round(resetSeconds));
  }
  if (previousWindowSeconds && previousWindowSeconds >= 60) {
    return Math.max(previousWindowSeconds, resetSeconds);
  }
  // Common Hypixel developer key: 300 requests / ~5 minutes.
  if (limit >= 250) return Math.max(300, resetSeconds);
  if (limit >= 100) return Math.max(60, resetSeconds);
  return Math.max(60, resetSeconds);
}

export function buildHypixelRateLimitSnapshot(
  headers: HypixelRateLimitHeaders,
  options: {
    source: "scan" | "probe";
    observedAt?: Date;
    previousWindowSeconds?: number | null;
  },
): HypixelRateLimitSnapshot {
  const observedAt = options.observedAt ?? new Date();
  return {
    limit: headers.limit,
    remaining: headers.remaining,
    resetSeconds: headers.resetSeconds,
    observedAt: observedAt.toISOString(),
    source: options.source,
    windowSeconds: estimateHypixelWindowSeconds(
      headers.limit,
      headers.resetSeconds,
      headers.remaining,
      options.previousWindowSeconds,
    ),
  };
}

/**
 * Recommend a per-account scan interval so the watch list fits under the key budget.
 * Assumes ~1 Hypixel request per account scan.
 */
export function recommendScanIntervalSeconds(input: {
  watchlistCount: number;
  limit: number;
  windowSeconds: number;
  /** Fraction of the limit to leave unused (default 15%). */
  headroom?: number;
  minIntervalSeconds?: number;
  maxIntervalSeconds?: number;
}): number {
  const count = Math.max(0, Math.floor(input.watchlistCount));
  const limit = Math.max(1, Math.floor(input.limit));
  const windowSeconds = Math.max(60, Math.floor(input.windowSeconds));
  const headroom = input.headroom ?? 0.85;
  const minInterval = input.minIntervalSeconds ?? 30;
  const maxInterval = input.maxIntervalSeconds ?? 86_400;

  if (count === 0) return minInterval;

  const budget = Math.max(1, Math.floor(limit * headroom));
  // count * (window / interval) <= budget  →  interval >= count * window / budget
  const recommended = Math.ceil((count * windowSeconds) / budget);
  return Math.min(maxInterval, Math.max(minInterval, recommended));
}

/** Used requests in the observed snapshot (clamped). */
export function usedFromSnapshot(snapshot: Pick<HypixelRateLimitSnapshot, "limit" | "remaining">): number {
  return Math.max(0, snapshot.limit - snapshot.remaining);
}

/** Absolute time when the observed window should reset. */
export function resetAtFromSnapshot(snapshot: Pick<HypixelRateLimitSnapshot, "observedAt" | "resetSeconds">): Date {
  return new Date(new Date(snapshot.observedAt).getTime() + snapshot.resetSeconds * 1000);
}
