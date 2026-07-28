/** Hypixel API rate-limit helpers (response headers + scan pacing). */

/**
 * Target fraction of the key limit to consume each window.
 * Kept intentionally conservative (45% of 300 ≈ 135 / 5min) to leave headroom
 * for PitPal confirm scans and avoid tripwire rate limits.
 */
export const DEFAULT_HYPIXEL_BUDGET_UTILIZATION = 0.45;

/**
 * Legacy floor when 140ers were still auto-indexed slowly.
 * Auto Hypixel scans for 140ers are now skipped entirely; this remains for
 * parked schedule cursors / older settings copy.
 */
export const HYPIXEL_140ER_INTERVAL_SECONDS = 30 * 60;

/** How far to park 140er nextScanAt when the scheduler skips them. */
export const HYPIXEL_140ER_PARK_INTERVAL_SECONDS = 24 * 60 * 60;

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

export function hypixelBudgetPerWindow(
  limit: number,
  utilization: number = DEFAULT_HYPIXEL_BUDGET_UTILIZATION,
): number {
  return Math.max(1, Math.floor(Math.max(1, limit) * utilization));
}

/**
 * Recommend a per-account scan interval so the watch list fits under the key budget.
 * Assumes ~1 Hypixel request per account scan.
 */
export function recommendScanIntervalSeconds(input: {
  watchlistCount: number;
  limit: number;
  windowSeconds: number;
  /** Fraction of the limit to consume (default 45%). */
  utilization?: number;
  /** @deprecated Use `utilization` — kept as an alias for older callers. */
  headroom?: number;
  minIntervalSeconds?: number;
  maxIntervalSeconds?: number;
}): number {
  const count = Math.max(0, Math.floor(input.watchlistCount));
  const limit = Math.max(1, Math.floor(input.limit));
  const windowSeconds = Math.max(60, Math.floor(input.windowSeconds));
  const utilization = input.utilization ?? input.headroom ?? DEFAULT_HYPIXEL_BUDGET_UTILIZATION;
  const minInterval = input.minIntervalSeconds ?? 30;
  const maxInterval = input.maxIntervalSeconds ?? 86_400;

  if (count === 0) return minInterval;

  const budget = hypixelBudgetPerWindow(limit, utilization);
  // count * (window / interval) <= budget  →  interval >= count * window / budget
  const recommended = Math.ceil((count * windowSeconds) / budget);
  return Math.min(maxInterval, Math.max(minInterval, recommended));
}

/**
 * Split pacing: slow (140er) accounts at a fixed floor, remaining budget for everyone else.
 */
export function recommendSplitScanIntervals(input: {
  normalCount: number;
  slowCount: number;
  limit: number;
  windowSeconds: number;
  slowIntervalSeconds?: number;
  utilization?: number;
  minIntervalSeconds?: number;
  maxIntervalSeconds?: number;
}): { normalIntervalSeconds: number; slowIntervalSeconds: number } {
  const slowInterval = Math.max(
    30,
    Math.floor(input.slowIntervalSeconds ?? HYPIXEL_140ER_INTERVAL_SECONDS),
  );
  const normalCount = Math.max(0, Math.floor(input.normalCount));
  const slowCount = Math.max(0, Math.floor(input.slowCount));
  const limit = Math.max(1, Math.floor(input.limit));
  const windowSeconds = Math.max(60, Math.floor(input.windowSeconds));
  const utilization = input.utilization ?? DEFAULT_HYPIXEL_BUDGET_UTILIZATION;
  const minInterval = input.minIntervalSeconds ?? 30;
  const maxInterval = input.maxIntervalSeconds ?? 86_400;

  const budget = hypixelBudgetPerWindow(limit, utilization);
  const slowCost = slowCount > 0 ? (slowCount * windowSeconds) / slowInterval : 0;
  const remainingBudget = Math.max(1, budget - slowCost);

  if (normalCount === 0) {
    return { normalIntervalSeconds: minInterval, slowIntervalSeconds: slowInterval };
  }

  const normalIntervalSeconds = Math.min(
    maxInterval,
    Math.max(minInterval, Math.ceil((normalCount * windowSeconds) / remainingBudget)),
  );
  return { normalIntervalSeconds, slowIntervalSeconds: slowInterval };
}

/**
 * How many scheduled scans to enqueue this tick so usage tracks ~utilization through the window.
 * Returns at least 1 when due work exists and we are not clearly ahead of the budget curve.
 */
export function scanEnqueueAllowance(input: {
  snapshot: Pick<
    HypixelRateLimitSnapshot,
    "limit" | "remaining" | "resetSeconds" | "windowSeconds" | "observedAt"
  > | null;
  dueCount: number;
  utilization?: number;
  maxPerTick?: number;
  /** Extra scans allowed ahead of the ideal curve so the drip does not stall. */
  lead?: number;
  now?: Date;
}): number {
  const dueCount = Math.max(0, Math.floor(input.dueCount));
  if (dueCount === 0) return 0;

  const maxPerTick = Math.max(1, Math.floor(input.maxPerTick ?? 2));
  if (!input.snapshot) {
    // No quota sample yet — keep a gentle drip.
    return Math.min(1, dueCount);
  }

  const utilization = input.utilization ?? DEFAULT_HYPIXEL_BUDGET_UTILIZATION;
  const lead = input.lead ?? 1;
  const now = input.now ?? new Date();
  const { limit, remaining, resetSeconds, windowSeconds, observedAt } = input.snapshot;
  const budget = hypixelBudgetPerWindow(limit, utilization);

  const observedMs = Date.parse(observedAt);
  const elapsedSinceObserve = Number.isFinite(observedMs)
    ? Math.max(0, (now.getTime() - observedMs) / 1000)
    : 0;
  const timeLeft = Math.max(0, resetSeconds - elapsedSinceObserve);
  const window = Math.max(60, windowSeconds);
  const fractionDone = Math.min(1, Math.max(0, 1 - timeLeft / window));
  const targetUsed = budget * fractionDone;
  const used = Math.max(0, limit - remaining);
  const deficit = targetUsed + lead - used;

  // Hard stop near empty remaining so we do not trip the key.
  if (remaining <= Math.max(2, Math.floor(limit * 0.05))) {
    return 0;
  }

  if (deficit <= 0) {
    return 0;
  }

  return Math.min(dueCount, maxPerTick, Math.max(1, Math.ceil(deficit)));
}

/** Used requests in the observed snapshot (clamped). */
export function usedFromSnapshot(snapshot: Pick<HypixelRateLimitSnapshot, "limit" | "remaining">): number {
  return Math.max(0, snapshot.limit - snapshot.remaining);
}

/** Absolute time when the observed window should reset. */
export function resetAtFromSnapshot(snapshot: Pick<HypixelRateLimitSnapshot, "observedAt" | "resetSeconds">): Date {
  return new Date(new Date(snapshot.observedAt).getTime() + snapshot.resetSeconds * 1000);
}
