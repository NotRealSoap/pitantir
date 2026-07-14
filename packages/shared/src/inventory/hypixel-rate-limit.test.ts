import { describe, expect, it } from "vitest";
import {
  buildHypixelRateLimitSnapshot,
  estimateHypixelWindowSeconds,
  parseHypixelRateLimitHeaders,
  recommendScanIntervalSeconds,
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
  it("paces 189 accounts under a 300/5min key with headroom", () => {
    const interval = recommendScanIntervalSeconds({
      watchlistCount: 189,
      limit: 300,
      windowSeconds: 300,
      headroom: 0.85,
    });
    // 189 * 300 / floor(300*0.85=255) = 223ish → allow room but stay under an hour
    expect(interval).toBeGreaterThanOrEqual(200);
    expect(interval).toBeLessThanOrEqual(300);
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
