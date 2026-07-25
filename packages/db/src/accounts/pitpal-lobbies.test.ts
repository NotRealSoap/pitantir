import { describe, expect, it } from "vitest";
import {
  formatPitpalPresenceLine,
  listLobbyMateNames,
  normalizePitpalLobbySnapshot,
  shouldAttachLobbyMatesOnEnter,
} from "./pitpal-lobbies.js";

describe("normalizePitpalLobbySnapshot", () => {
  it("counts lobbies and players", () => {
    const snapshot = normalizePitpalLobbySnapshot({
      observedAt: "2026-07-21T21:00:00.000Z",
      source: "test",
      players: [
        { name: "loathbred", lobbyName: "M23A", location: "DOWN", armorType: "GOLD", killStreak: 110 },
        { name: "takahiroryuu27", lobbyName: "M23A", location: "SPAWN", armorType: "MYSTIC" },
        { name: "bloomid", lobbyName: "M3B", location: "DOWN", armorType: "GOLD", killStreak: 170 },
      ],
    });
    expect(snapshot.playerCount).toBe(3);
    expect(snapshot.lobbyCount).toBe(2);
  });
});

describe("formatPitpalPresenceLine", () => {
  it("includes lobby and status", () => {
    expect(
      formatPitpalPresenceLine({
        mcUsername: "Crazy",
        lobby: "M23A",
        location: "DOWN",
        armorType: "GOLD",
        killStreak: 40,
      }),
    ).toBe("Crazy · M23A · DOWN · GOLD · 40 ks");
  });

  it("includes Nicked when flagged", () => {
    expect(
      formatPitpalPresenceLine({
        mcUsername: "NickGuy",
        lobby: "M1A",
        location: "SPAWN",
        isNicked: true,
      }),
    ).toBe("NickGuy · M1A · SPAWN · Nicked");
  });
});

describe("listLobbyMateNames", () => {
  it("returns every IGN in the lobby, sorted", () => {
    expect(
      listLobbyMateNames(
        [
          { name: "zeta", lobbyName: "M1B", location: "DOWN" },
          { name: "jc_treepuncher", lobbyName: "M1B", location: "SPAWN" },
          { name: "alpha", lobbyName: "M1B", location: "OTHER" },
          { name: "otherlobby", lobbyName: "M2A", location: "SPAWN" },
        ],
        "M1B",
      ),
    ).toEqual(["alpha", "jc_treepuncher", "zeta"]);
  });
});

describe("shouldAttachLobbyMatesOnEnter", () => {
  it("allows non-140er furry-stash accounts", () => {
    expect(
      shouldAttachLobbyMatesOnEnter({
        mcUsername: "jc_treepuncher",
        notes: "furry-stashes",
      }),
    ).toBe(true);
    expect(
      shouldAttachLobbyMatesOnEnter({
        mcUsername: "jc_treepuncher",
        notes: "furry-stashes: trader",
      }),
    ).toBe(true);
  });

  it("rejects non-furry, 140er, and blank-notes accounts", () => {
    expect(
      shouldAttachLobbyMatesOnEnter({
        mcUsername: "DownwatchOnly",
        notes: "trader",
      }),
    ).toBe(false);
    expect(
      shouldAttachLobbyMatesOnEnter({
        mcUsername: "jc_treepuncher",
        notes: "furry-stashes: 140er",
      }),
    ).toBe(false);
    expect(
      shouldAttachLobbyMatesOnEnter({ mcUsername: "RandomGuy", notes: null }),
    ).toBe(false);
  });
});
