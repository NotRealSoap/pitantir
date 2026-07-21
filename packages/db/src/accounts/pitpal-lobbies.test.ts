import { describe, expect, it } from "vitest";
import { formatPitpalPresenceLine, normalizePitpalLobbySnapshot } from "./pitpal-lobbies.js";

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
});
