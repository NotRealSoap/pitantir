import { describe, expect, it } from "vitest";
import {
  buildHypixelRateLimitSnapshot,
  DEFAULT_HYPIXEL_BUDGET_UTILIZATION,
  estimateHypixelWindowSeconds,
  hypixelBudgetPerWindow,
  parseHypixelRateLimitHeaders,
  recommendScanIntervalSeconds,
  recommendSplitScanIntervals,
  scanEnqueueAllowance,
  usedFromSnapshot,
} from "./hypixel-rate-limit.js";

describe("parseHypixelRateLimitHeaders", () => {
  it("reads Hypixel rate limit headers", () => {
    const headers = new Headers({
      "RateLimit-Limit": "300",
      "RateLimit-Remaining": "280",
      "RateLimit-Reset": "240",
    });
    expect(parseHypixelRateLimitHeaders(headers)).toEqual({
      limit: 300,
      remaining: 280,
      resetSeconds: 240,
    });
  });

  it("returns null when headers are missing", () => {
    expect(parseHypixelRateLimitHeaders(new Headers())).toBeNull();
  });
});

describe("estimateHypixelWindowSeconds", () => {
  it("treats reset as full window when remaining is near limit", () => {
    expect(estimateHypixelWindowSeconds(300, 295, 299)).toBe(295);
  });

  it("keeps common 5-minute window for 300-limit keys mid-window", () => {
    expect(estimateHypixelWindowSeconds(300, 120, 200)).toBe(300);
  });
});

describe("recommendScanIntervalSeconds", () => {
  it("paces 189 accounts under a 300/5min key at 80% utilization", () => {
    const interval = recommendScanIntervalSeconds({
      watchlistCount: 189,
      limit: 300,
      windowSeconds: 300,
      utilization: 0.8,
    });
    // 189 * 300 / floor(300*0.8=240) = 237
    expect(interval).toBeGreaterThanOrEqual(200);
    expect(interval).toBeLessThanOrEqual(300);
  });

  it("defaults to 80% utilization", () => {
    expect(DEFAULT_HYPIXEL_BUDGET_UTILIZATION).toBe(0.8);
    expect(hypixelBudgetPerWindow(300)).toBe(240);
  });

  it("allows faster refresh for a small watch list", () => {
    const interval = recommendScanIntervalSeconds({
      watchlistCount: 6,
      limit: 300,
      windowSeconds: 300,
    });
    expect(interval).toBe(30);
  });
});

describe("recommendSplitScanIntervals", () => {
  it("reserves 140er cost and speeds up non-140ers", () => {
    const split = recommendSplitScanIntervals({
      normalCount: 40,
      slowCount: 160,
      limit: 300,
      windowSeconds: 300,
      slowIntervalSeconds: 1800,
    });
    expect(split.slowIntervalSeconds).toBe(1800);
    // slow cost ≈ 160*300/1800 ≈ 26.7 → remaining ≈ 213 → 40*300/213 ≈ 57
    expect(split.normalIntervalSeconds).toBeGreaterThanOrEqual(30);
    expect(split.normalIntervalSeconds).toBeLessThan(120);
  });
});

describe("scanEnqueueAllowance", () => {
  it("drips one when no snapshot yet", () => {
    expect(scanEnqueueAllowance({ snapshot: null, dueCount: 10 })).toBe(1);
  });

  it("opens the tap when behind the 80% curve", () => {
    const allowance = scanEnqueueAllowance({
      dueCount: 20,
      maxPerTick: 4,
      lead: 3,
      now: new Date("2026-07-14T03:02:00.000Z"),
      snapshot: {
        limit: 300,
        remaining: 290, // used 10
        resetSeconds: 300,
        windowSeconds: 300,
        // observed 2 minutes ago with reset still ~full → mid-window underutilized
        observedAt: "2026-07-14T03:00:00.000Z",
      },
    });
    // elapsed 120s, timeLeft 180, fractionDone 0.4, targetUsed 96, deficit 96+3-10 → allow max 4
    expect(allowance).toBe(4);
  });

  it("throttles when ahead of the budget curve", () => {
    const allowance = scanEnqueueAllowance({
      dueCount: 20,
      maxPerTick: 4,
      lead: 3,
      now: new Date("2026-07-14T03:00:30.000Z"),
      snapshot: {
        limit: 300,
        remaining: 50, // used 250 already early in window
        resetSeconds: 270,
        windowSeconds: 300,
        observedAt: "2026-07-14T03:00:00.000Z",
      },
    });
    expect(allowance).toBe(0);
  });
});

describe("buildHypixelRateLimitSnapshot", () => {
  it("fills used/window fields from headers", () => {
    const snapshot = buildHypixelRateLimitSnapshot(
      { limit: 300, remaining: 294, resetSeconds: 261 },
      { source: "probe", observedAt: new Date("2026-07-14T03:00:00.000Z") },
    );
    expect(usedFromSnapshot(snapshot)).toBe(6);
    expect(snapshot.windowSeconds).toBeGreaterThanOrEqual(261);
    expect(snapshot.source).toBe("probe");
  });
});
