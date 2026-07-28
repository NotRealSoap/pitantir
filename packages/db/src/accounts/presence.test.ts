import { describe, expect, it } from "vitest";
import {
  effectiveScanIntervalSeconds,
  effectiveScanPriority,
  PRESENCE_140ER_INTERVAL_SECONDS,
  PRESENCE_HOT_INTERVAL_SECONDS,
  PRESENCE_HOT_PRIORITY,
  resolveEffectivePresence,
} from "./presence.js";

const base = {
  lastHypixelOnline: false as boolean | null,
  lastPitpalLobby: null as string | null,
  lastPitpalLocation: null as string | null,
  lastPitpalSeenAt: null as Date | null,
  scanIntervalSeconds: 3600,
  priority: 100,
  notes: null as string | null,
};

describe("resolveEffectivePresence", () => {
  it("treats fresh PitPal listing as online even when Hypixel is offline (API Off)", () => {
    const presence = resolveEffectivePresence(
      {
        ...base,
        lastHypixelOnline: false,
        lastPitpalLobby: "M23A",
        lastPitpalLocation: "SPAWN",
        lastPitpalSeenAt: new Date(),
      },
      { nowMs: Date.now() },
    );
    expect(presence.online).toBe(true);
    expect(presence.apiOff).toBe(true);
    expect(presence.pitpalListed).toBe(true);
    expect(presence.pitpalAuthoritative).toBe(false);
  });

  it("is normal online when Hypixel agrees", () => {
    const presence = resolveEffectivePresence({
      ...base,
      lastHypixelOnline: true,
      lastPitpalLobby: "M23A",
      lastPitpalLocation: "DOWN",
      lastPitpalSeenAt: new Date(),
    });
    expect(presence.online).toBe(true);
    expect(presence.apiOff).toBe(false);
  });

  it("is offline when neither PitPal nor Hypixel says online", () => {
    expect(resolveEffectivePresence(base).online).toBe(false);
    expect(resolveEffectivePresence(base).apiOff).toBe(false);
  });

  it("ignores stale PitPal sightings", () => {
    const presence = resolveEffectivePresence(
      {
        ...base,
        lastHypixelOnline: false,
        lastPitpalLobby: "M23A",
        lastPitpalLocation: "SPAWN",
        lastPitpalSeenAt: new Date(Date.now() - 10 * 60_000),
      },
      { nowMs: Date.now() },
    );
    expect(presence.online).toBe(false);
    expect(presence.apiOff).toBe(false);
  });

  it("when PitPal-authoritative, Hypixel online alone does not count", () => {
    const presence = resolveEffectivePresence(
      {
        ...base,
        lastHypixelOnline: true,
        lastPitpalLobby: null,
        lastPitpalLocation: null,
        lastPitpalSeenAt: null,
      },
      { pitpalAuthoritative: true },
    );
    expect(presence.online).toBe(false);
    expect(presence.pitpalAuthoritative).toBe(true);
  });

  it("when PitPal-authoritative, fresh listing is online despite Hypixel offline", () => {
    const presence = resolveEffectivePresence(
      {
        ...base,
        lastHypixelOnline: false,
        lastPitpalLobby: "M23A",
        lastPitpalLocation: "DOWN",
        lastPitpalSeenAt: new Date(),
      },
      { pitpalAuthoritative: true, nowMs: Date.now() },
    );
    expect(presence.online).toBe(true);
    expect(presence.apiOff).toBe(true);
    expect(presence.pitpalAuthoritative).toBe(true);
  });

  it("without PitPal-authoritative, Hypixel online alone still counts", () => {
    const presence = resolveEffectivePresence({
      ...base,
      lastHypixelOnline: true,
    });
    expect(presence.online).toBe(true);
    expect(presence.pitpalAuthoritative).toBe(false);
  });
});

describe("hotspot scheduling helpers", () => {
  it("shortens interval and priority while effectively online", () => {
    const hotAccount = {
      ...base,
      lastHypixelOnline: true,
    };
    expect(effectiveScanIntervalSeconds(hotAccount)).toBe(PRESENCE_HOT_INTERVAL_SECONDS);
    expect(effectiveScanPriority(hotAccount)).toBe(PRESENCE_HOT_PRIORITY);
  });

  it("keeps cool interval when offline", () => {
    expect(effectiveScanIntervalSeconds(base)).toBe(3600);
    expect(effectiveScanPriority(base)).toBe(100);
  });

  it("parks 140er accounts at 30 minutes even when online (auto Hypixel skipped)", () => {
    const labeled = {
      ...base,
      lastHypixelOnline: true,
      notes: "furry-stashes: 140er",
      scanIntervalSeconds: 120,
      priority: 20,
    };
    expect(effectiveScanIntervalSeconds(labeled)).toBe(PRESENCE_140ER_INTERVAL_SECONDS);
    expect(effectiveScanPriority(labeled)).toBe(20);
  });
});
