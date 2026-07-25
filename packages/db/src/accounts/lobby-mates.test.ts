import { describe, expect, it } from "vitest";
import {
  applyLobbyMateTouch,
  buildLobbyMateSessionPayload,
  formatLobbyMateTouchesBlock,
  formatTouchClock,
  listLobbyMateNames,
  shouldTrackLobbyMates,
} from "./lobby-mates.js";

describe("shouldTrackLobbyMates", () => {
  it("allows non-140er furry-stash accounts", () => {
    expect(
      shouldTrackLobbyMates({ mcUsername: "jc_treepuncher", notes: "furry-stashes" }),
    ).toBe(true);
  });

  it("rejects non-furry and 140er accounts", () => {
    expect(shouldTrackLobbyMates({ mcUsername: "DownOnly", notes: "trader" })).toBe(false);
    expect(
      shouldTrackLobbyMates({
        mcUsername: "jc_treepuncher",
        notes: "furry-stashes: 140er",
      }),
    ).toBe(false);
  });
});

describe("listLobbyMateNames", () => {
  it("returns every IGN in the lobby", () => {
    expect(
      listLobbyMateNames(
        [
          { name: "zeta", lobbyName: "M1B" },
          { name: "jc_treepuncher", lobbyName: "M1B" },
          { name: "alpha", lobbyName: "M1B" },
          { name: "other", lobbyName: "M2A" },
        ],
        "M1B",
      ),
    ).toEqual(["alpha", "jc_treepuncher", "zeta"]);
  });
});

describe("applyLobbyMateTouch", () => {
  it("records per-lobby timestamps and keeps prior lobby touches", () => {
    const started = applyLobbyMateTouch({
      previous: null,
      accountId: "a1",
      mcUsername: "jc_treepuncher",
      lobby: "M1B",
      location: "SPAWN",
      currentMates: ["jc_treepuncher", "alpha"],
      at: "2026-07-25T01:00:00.000Z",
    });
    expect(started.reason).toBe("started");
    expect(started.session.touches).toEqual([
      { mcUsername: "alpha", lobby: "M1B", at: "2026-07-25T01:00:00.000Z" },
      { mcUsername: "jc_treepuncher", lobby: "M1B", at: "2026-07-25T01:00:00.000Z" },
    ]);

    const hopped = applyLobbyMateTouch({
      previous: started.session,
      accountId: "a1",
      mcUsername: "jc_treepuncher",
      lobby: "M2A",
      location: "DOWN",
      currentMates: ["jc_treepuncher", "bravo"],
      at: "2026-07-25T01:01:00.000Z",
    });
    expect(hopped.reason).toBe("lobby");
    expect(hopped.session.lobbies).toEqual(["M1B", "M2A"]);
    expect(hopped.session.touches).toEqual([
      { mcUsername: "alpha", lobby: "M1B", at: "2026-07-25T01:00:00.000Z" },
      { mcUsername: "jc_treepuncher", lobby: "M1B", at: "2026-07-25T01:00:00.000Z" },
      { mcUsername: "bravo", lobby: "M2A", at: "2026-07-25T01:01:00.000Z" },
      { mcUsername: "jc_treepuncher", lobby: "M2A", at: "2026-07-25T01:01:00.000Z" },
    ]);

    const grew = applyLobbyMateTouch({
      previous: hopped.session,
      accountId: "a1",
      mcUsername: "jc_treepuncher",
      lobby: "M2A",
      location: "DOWN",
      currentMates: ["jc_treepuncher", "bravo", "charlie"],
      at: "2026-07-25T01:02:00.000Z",
    });
    expect(grew.reason).toBe("mates");
    expect(grew.session.touches.some((touch) => touch.mcUsername === "charlie")).toBe(true);
    expect(
      grew.session.touches.find((touch) => touch.mcUsername === "charlie")?.at,
    ).toBe("2026-07-25T01:02:00.000Z");
  });
});

describe("formatLobbyMateTouchesBlock", () => {
  it("groups by lobby with timestamps", () => {
    const block = formatLobbyMateTouchesBlock({
      lobbies: ["M1B", "M2A"],
      touches: [
        { mcUsername: "alpha", lobby: "M1B", at: "2026-07-25T01:00:00.000Z" },
        { mcUsername: "bravo", lobby: "M2A", at: "2026-07-25T01:01:00.000Z" },
      ],
    });
    expect(block).toContain("**M1B (1)**");
    expect(block).toContain("**M2A (1)**");
    expect(block).toContain(`alpha — ${formatTouchClock("2026-07-25T01:00:00.000Z")}`);
    expect(block).toContain(`bravo — ${formatTouchClock("2026-07-25T01:01:00.000Z")}`);
  });
});

describe("buildLobbyMateSessionPayload", () => {
  it("lists touches under lobby headings", () => {
    const payload = buildLobbyMateSessionPayload({
      accountId: "a1",
      mcUsername: "jc_treepuncher",
      startedAt: "2026-07-25T01:00:00.000Z",
      currentLobby: "M1B",
      currentLocation: "SPAWN",
      lobbies: ["M1B"],
      touches: [
        { mcUsername: "alpha", lobby: "M1B", at: "2026-07-25T01:00:00.000Z" },
        { mcUsername: "jc_treepuncher", lobby: "M1B", at: "2026-07-25T01:00:00.000Z" },
      ],
      discordMessageId: null,
      lastPostedKey: null,
    });
    expect(payload.content).toContain("jc_treepuncher entered Pit · M1B · SPAWN");
    expect(payload.content).toContain("**M1B (2)**");
    expect(payload.content).toContain("alpha");
    expect(JSON.stringify(payload.embeds)).toContain("M1B (2)");
  });
});
