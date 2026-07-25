import { describe, expect, it } from "vitest";
import {
  applyLobbyMateTouch,
  buildLobbyMateSessionPages,
  buildLobbyMateSessionPayload,
  formatTouchClock,
  listLobbyMateNames,
  paginateLobbyMateContent,
  shouldTrackLobbyMates,
  type LobbyMateLobbySection,
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
  });
});

describe("paginateLobbyMateContent", () => {
  it("spills overflow into continuation pages instead of +N more", () => {
    const sections: LobbyMateLobbySection[] = [
      {
        lobby: "M1B",
        total: 40,
        lines: Array.from({ length: 40 }, (_, index) => `• player${index} — <t:1:t>`),
      },
      {
        lobby: "M2A",
        total: 40,
        lines: Array.from({ length: 40 }, (_, index) => `• other${index} — <t:2:t>`),
      },
    ];
    const pages = paginateLobbyMateContent("Hero entered Pit · M2A · SPAWN", sections, {
      maxChars: 500,
    });
    expect(pages.length).toBeGreaterThan(1);
    const joined = pages.join("\n");
    expect(joined).toContain("player0");
    expect(joined).toContain("player39");
    expect(joined).toContain("other0");
    expect(joined).toContain("other39");
    expect(joined).not.toMatch(/\+\d+ more/);
    expect(pages[0]).toContain("page 1/");
    expect(pages.at(-1)).toContain(`page ${pages.length}/${pages.length}`);
  });
});

describe("buildLobbyMateSessionPayload", () => {
  it("lists touches under lobby headings", () => {
    const session = {
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
      discordMessageIds: [] as string[],
      lastPostedKey: null,
    };
    const payload = buildLobbyMateSessionPayload(session);
    expect(payload.content).toContain("jc_treepuncher entered Pit · M1B · SPAWN");
    expect(payload.content).toContain("**M1B (2)**");
    expect(payload.content).toContain("alpha");
    expect(payload.content).toContain(formatTouchClock("2026-07-25T01:00:00.000Z"));

    const pages = buildLobbyMateSessionPages(session);
    expect(pages.pages).toHaveLength(1);
  });
});
