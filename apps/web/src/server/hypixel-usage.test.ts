import { describe, expect, it } from "vitest";
import type { PublicAccount } from "@pitantir/db";
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
    expect(view.recommendedSlowIntervalSeconds).toBe(1800);
    expect(view.estimatedBudgetPerWindow).toBe(240);
    expect(view.budgetUtilization).toBe(0.8);
    expect(view.currentIntervalSeconds).toBe(3600);
    expect(view.stale).toBe(false);
  });

  it("splits 140er accounts out of the fast recommendation", () => {
    const view = buildHypixelUsageView({
      configured: true,
      watchlist: [
        fakeAccount({ id: "1", notes: null }),
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
    expect(view.recommendedSlowIntervalSeconds).toBe(1800);
  });
});
