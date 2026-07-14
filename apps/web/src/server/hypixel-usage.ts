import {
  buildHypixelRateLimitSnapshot,
  parseHypixelRateLimitHeaders,
  recommendScanIntervalSeconds,
  resetAtFromSnapshot,
  usedFromSnapshot,
  type HypixelRateLimitSnapshot,
} from "@pitantir/shared/inventory";
import type { PublicAccount } from "@pitantir/db";

export interface HypixelUsageView {
  configured: boolean;
  snapshot: HypixelRateLimitSnapshot | null;
  used: number | null;
  resetAt: string | null;
  secondsUntilReset: number | null;
  stale: boolean;
  watchlistCount: number;
  refreshingCount: number;
  currentIntervalSeconds: number | null;
  recommendedIntervalSeconds: number | null;
  estimatedRequestsPerWindow: number | null;
  estimatedBudgetPerWindow: number | null;
}

export function buildHypixelUsageView(input: {
  configured: boolean;
  snapshot: HypixelRateLimitSnapshot | null;
  watchlist: PublicAccount[];
  now?: Date;
}): HypixelUsageView {
  const now = input.now ?? new Date();
  const refreshing = input.watchlist.filter((row) => row.enabled);
  const intervals = refreshing.map((row) => row.scanIntervalSeconds);
  const currentIntervalSeconds =
    intervals.length > 0 ? Math.min(...intervals) : input.watchlist[0]?.scanIntervalSeconds ?? null;

  let resetAt: string | null = null;
  let secondsUntilReset: number | null = null;
  let stale = false;
  if (input.snapshot) {
    const at = resetAtFromSnapshot(input.snapshot);
    resetAt = at.toISOString();
    secondsUntilReset = Math.max(0, Math.round((at.getTime() - now.getTime()) / 1000));
    stale = at.getTime() < now.getTime() - 5_000;
  }

  const recommendedIntervalSeconds = input.snapshot
    ? recommendScanIntervalSeconds({
        watchlistCount: Math.max(refreshing.length, 1),
        limit: input.snapshot.limit,
        windowSeconds: input.snapshot.windowSeconds,
      })
    : null;

  const estimatedBudgetPerWindow = input.snapshot
    ? Math.max(1, Math.floor(input.snapshot.limit * 0.85))
    : null;

  const estimatedRequestsPerWindow =
    recommendedIntervalSeconds != null && refreshing.length > 0
      ? Math.ceil((refreshing.length * (input.snapshot?.windowSeconds ?? 300)) / (currentIntervalSeconds ?? recommendedIntervalSeconds))
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
    currentIntervalSeconds,
    recommendedIntervalSeconds,
    estimatedRequestsPerWindow,
    estimatedBudgetPerWindow,
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
