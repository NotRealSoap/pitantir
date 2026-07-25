import { describe, expect, it } from "vitest";
import {
  applyLobbyMateTouch,
  buildLobbyMateSessionPayload,
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
  it("starts a session and accumulates mates across lobby hops", () => {
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
    expect(started.shouldPost).toBe(true);
    expect(started.session.touchedIgns).toEqual(["alpha", "jc_treepuncher"]);

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
    expect(hopped.session.touchedIgns).toEqual(["alpha", "bravo", "jc_treepuncher"]);

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
    expect(grew.session.touchedIgns).toEqual(["alpha", "bravo", "charlie", "jc_treepuncher"]);
  });
});

describe("buildLobbyMateSessionPayload", () => {
  it("lists cumulative touched IGNs", () => {
    const payload = buildLobbyMateSessionPayload({
      accountId: "a1",
      mcUsername: "jc_treepuncher",
      startedAt: "2026-07-25T01:00:00.000Z",
      currentLobby: "M1B",
      currentLocation: "SPAWN",
      lobbies: ["M1B"],
      touchedIgns: ["alpha", "jc_treepuncher"],
      discordMessageId: null,
      lastPostedKey: null,
    });
    expect(payload.content).toContain("jc_treepuncher entered Pit · M1B · SPAWN");
    expect(payload.content).toContain("alpha");
    expect(payload.content).toContain("Touched");
  });
});
