import { describe, expect, it } from "vitest";
import type { PublicAccount } from "@pitantir/db";
import { HYPIXEL_140ER_PARK_INTERVAL_SECONDS } from "@pitantir/shared/inventory";
import { buildHypixelUsageView } from "./hypixel-usage";

function fakeAccount(overrides: Partial<PublicAccount> = {}): PublicAccount {
  return {
    id: "a1",
    mcUuid: null,
    mcUsername: "Steve",
    displayName: null,
    enabled: true,
    watchlisted: true,
    priority: 100,
    scanIntervalSeconds: 3600,
    nextScanAt: new Date(),
    lastSuccessScanAt: null,
    lastFailureScanAt: null,
    lastHypixelOnline: null,
    lastHypixelOnlineAt: null,
    lastPresenceSource: null,
    lastSessionGame: null,
    lastInventoryHash: null,
    lastInventoryChangedAt: null,
    lastPitpalLobby: null,
    lastPitpalLocation: null,
    lastPitpalArmorType: null,
    lastPitpalKillstreak: null,
    lastPitpalSeenAt: null,
    lastPitpalIsNicked: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe("buildHypixelUsageView", () => {
  it("recommends a faster interval when quota allows", () => {
    const view = buildHypixelUsageView({
      configured: true,
      watchlist: [
        fakeAccount({ id: "1", scanIntervalSeconds: 3600 }),
        fakeAccount({ id: "2", mcUsername: "Alex", scanIntervalSeconds: 3600 }),
      ],
      snapshot: {
        limit: 300,
        remaining: 290,
        resetSeconds: 250,
        observedAt: "2026-07-14T03:00:00.000Z",
        source: "probe",
        windowSeconds: 300,
      },
      now: new Date("2026-07-14T03:00:10.000Z"),
    });

    expect(view.used).toBe(10);
    expect(view.refreshingCount).toBe(2);
    expect(view.recommendedIntervalSeconds).toBe(30);
    expect(view.recommendedSlowIntervalSeconds).toBe(HYPIXEL_140ER_PARK_INTERVAL_SECONDS);
    expect(view.estimatedBudgetPerWindow).toBe(135);
    expect(view.budgetUtilization).toBe(0.45);
    expect(view.currentIntervalSeconds).toBe(3600);
    expect(view.stale).toBe(false);
  });

  it("excludes 140er accounts from Hypixel budget estimates", () => {
    const view = buildHypixelUsageView({
      configured: true,
      watchlist: [
        fakeAccount({ id: "1", notes: null, scanIntervalSeconds: 300 }),
        fakeAccount({ id: "2", mcUsername: "Slow", notes: "furry-stashes: 140er" }),
      ],
      snapshot: {
        limit: 300,
        remaining: 290,
        resetSeconds: 250,
        observedAt: "2026-07-14T03:00:00.000Z",
        source: "probe",
        windowSeconds: 300,
      },
    });
    expect(view.normalRefreshingCount).toBe(1);
    expect(view.slowRefreshingCount).toBe(1);
    expect(view.skipped140erCount).toBe(1);
    expect(view.recommendedSlowIntervalSeconds).toBe(HYPIXEL_140ER_PARK_INTERVAL_SECONDS);
    // Only the non-140er at 300s contributes: 300/300 = 1 request / window
    expect(view.estimatedRequestsPerWindow).toBe(1);
  });
});
