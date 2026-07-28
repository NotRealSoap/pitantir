import {
  DEFAULT_HYPIXEL_BUDGET_UTILIZATION,
  HYPIXEL_140ER_PARK_INTERVAL_SECONDS,
  buildHypixelRateLimitSnapshot,
  hypixelBudgetPerWindow,
  parseHypixelRateLimitHeaders,
  recommendScanIntervalSeconds,
  recommendSplitScanIntervals,
  resetAtFromSnapshot,
  usedFromSnapshot,
  type HypixelRateLimitSnapshot,
} from "@pitantir/shared/inventory";
import type { PublicAccount } from "@pitantir/db";
import { notesIndicate140er } from "@pitantir/db";

export interface HypixelUsageView {
  configured: boolean;
  snapshot: HypixelRateLimitSnapshot | null;
  used: number | null;
  resetAt: string | null;
  secondsUntilReset: number | null;
  stale: boolean;
  watchlistCount: number;
  refreshingCount: number;
  /** Enabled watchlist accounts that are actually Hypixel-scanned (non-140er). */
  normalRefreshingCount: number;
  /** Enabled 140ers — parked / skipped for auto Hypixel. */
  slowRefreshingCount: number;
  /** Alias: 140ers excluded from Hypixel auto scans. */
  skipped140erCount: number;
  currentIntervalSeconds: number | null;
  recommendedIntervalSeconds: number | null;
  /** Park interval for 140ers (not an active scan cadence). */
  recommendedSlowIntervalSeconds: number | null;
  estimatedRequestsPerWindow: number | null;
  estimatedBudgetPerWindow: number | null;
  budgetUtilization: number;
}

export function buildHypixelUsageView(input: {
  configured: boolean;
  snapshot: HypixelRateLimitSnapshot | null;
  watchlist: PublicAccount[];
  now?: Date;
}): HypixelUsageView {
  const now = input.now ?? new Date();
  const refreshing = input.watchlist.filter((row) => row.enabled);
  const slowRefreshing = refreshing.filter((row) => notesIndicate140er(row.notes));
  const normalRefreshing = refreshing.filter((row) => !notesIndicate140er(row.notes));
  const intervals = normalRefreshing.map((row) => row.scanIntervalSeconds);
  const currentIntervalSeconds =
    intervals.length > 0
      ? Math.min(...intervals)
      : input.watchlist.find((row) => !notesIndicate140er(row.notes))?.scanIntervalSeconds ?? null;

  let resetAt: string | null = null;
  let secondsUntilReset: number | null = null;
  let stale = false;
  if (input.snapshot) {
    const at = resetAtFromSnapshot(input.snapshot);
    resetAt = at.toISOString();
    secondsUntilReset = Math.max(0, Math.round((at.getTime() - now.getTime()) / 1000));
    stale = at.getTime() < now.getTime() - 5_000;
  }

  // 140ers cost 0 Hypixel budget — recommendations pace only non-140ers.
  const split = input.snapshot
    ? recommendSplitScanIntervals({
        normalCount: normalRefreshing.length,
        slowCount: 0,
        limit: input.snapshot.limit,
        windowSeconds: input.snapshot.windowSeconds,
        slowIntervalSeconds: HYPIXEL_140ER_PARK_INTERVAL_SECONDS,
      })
    : null;

  const recommendedIntervalSeconds = input.snapshot
    ? split?.normalIntervalSeconds ??
      recommendScanIntervalSeconds({
        watchlistCount: Math.max(normalRefreshing.length, 1),
        limit: input.snapshot.limit,
        windowSeconds: input.snapshot.windowSeconds,
      })
    : null;

  const estimatedBudgetPerWindow = input.snapshot
    ? hypixelBudgetPerWindow(input.snapshot.limit, DEFAULT_HYPIXEL_BUDGET_UTILIZATION)
    : null;

  const estimatedRequestsPerWindow =
    input.snapshot && normalRefreshing.length > 0
      ? Math.ceil(
          normalRefreshing.reduce((sum, row) => {
            const interval = Math.max(30, row.scanIntervalSeconds || 3600);
            return sum + input.snapshot!.windowSeconds / interval;
          }, 0),
        )
      : input.snapshot
        ? 0
        : null;

  return {
    configured: input.configured,
    snapshot: input.snapshot,
    used: input.snapshot ? usedFromSnapshot(input.snapshot) : null,
    resetAt,
    secondsUntilReset,
    stale,
    watchlistCount: input.watchlist.length,
    refreshingCount: refreshing.length,
    normalRefreshingCount: normalRefreshing.length,
    slowRefreshingCount: slowRefreshing.length,
    skipped140erCount: slowRefreshing.length,
    currentIntervalSeconds,
    recommendedIntervalSeconds,
    recommendedSlowIntervalSeconds: HYPIXEL_140ER_PARK_INTERVAL_SECONDS,
    estimatedRequestsPerWindow,
    estimatedBudgetPerWindow,
    budgetUtilization: DEFAULT_HYPIXEL_BUDGET_UTILIZATION,
  };
}

/**
 * One cheap Hypixel call to sample RateLimit-* headers (uses 1 request of quota).
 */
export async function probeHypixelRateLimit(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  previousWindowSeconds?: number | null;
}): Promise<HypixelRateLimitSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.hypixel.net/v2/punishmentstats", {
    headers: {
      "API-Key": options.apiKey,
      Accept: "application/json",
    },
  });

  if (response.status === 403) {
    throw new Error("Hypixel API key rejected");
  }
  if (response.status === 429) {
    const parsed = parseHypixelRateLimitHeaders(response.headers);
    if (parsed) {
      return buildHypixelRateLimitSnapshot(parsed, {
        source: "probe",
        previousWindowSeconds: options.previousWindowSeconds,
      });
    }
    throw new Error("Hypixel rate limited");
  }
  if (!response.ok) {
    throw new Error(`Hypixel HTTP ${response.status}`);
  }

  const parsed = parseHypixelRateLimitHeaders(response.headers);
  if (!parsed) {
    throw new Error("Hypixel response missing RateLimit headers");
  }
  return buildHypixelRateLimitSnapshot(parsed, {
    source: "probe",
    previousWindowSeconds: options.previousWindowSeconds,
  });
}
