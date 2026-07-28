import { describe, expect, it } from "vitest";
import {
  applyLobbyMateTouch,
  buildLobbyMateDiscordNotice,
  buildLobbyMateTxtLog,
  formatTouchRange,
  listLobbyMateNames,
  lobbyMateAttachmentFilename,
  LOBBY_MATE_TRAIL_MS,
  refreshTouchesStillInLobby,
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
        ],
        "M1B",
      ),
    ).toEqual(["alpha", "jc_treepuncher", "zeta"]);
  });
});

describe("applyLobbyMateTouch", () => {
  it("tracks first/last windows and trails a lobby for 20s after leave", () => {
    const t0 = "2026-07-25T02:00:00.000Z";
    const t1 = "2026-07-25T02:00:10.000Z";
    const tLeave = "2026-07-25T02:00:20.000Z";
    const tTrail = "2026-07-25T02:00:30.000Z";
    const tDone = new Date(Date.parse(tLeave) + LOBBY_MATE_TRAIL_MS + 1).toISOString();

    const started = applyLobbyMateTouch({
      previous: null,
      accountId: "a1",
      mcUsername: "jc_treepuncher",
      lobby: "M1B",
      location: "SPAWN",
      currentMates: ["jc_treepuncher", "alpha"],
      at: t0,
      inPit: true,
    });
    expect(started.reason).toBe("started");
    expect(started.session.touches[0]).toMatchObject({
      mcUsername: "alpha",
      lobby: "M1B",
      firstAt: t0,
      lastAt: t0,
    });

    const extended = applyLobbyMateTouch({
      previous: started.session,
      accountId: "a1",
      mcUsername: "jc_treepuncher",
      lobby: "M1B",
      location: "SPAWN",
      currentMates: ["jc_treepuncher", "alpha"],
      at: t1,
      inPit: true,
    });
    expect(extended.shouldPost).toBe(false);
    expect(
      extended.session.touches.find((touch) => touch.mcUsername === "alpha")?.lastAt,
    ).toBe(t1);

    const left = applyLobbyMateTouch({
      previous: extended.session,
      accountId: "a1",
      mcUsername: "jc_treepuncher",
      lobby: null,
      location: null,
      currentMates: [],
      trailingMatesByLobby: {
        M1B: ["alpha", "bravo"],
      },
      at: tLeave,
      inPit: false,
    });
    expect(left.reason).toBe("left");
    expect(left.ended).toBe(false);
    expect(left.session.trailing).toHaveLength(1);
    expect(left.session.trailing[0]?.lobby).toBe("M1B");
    // bravo was not a prior touch — trailing only extends existing co-presence.
    expect(left.session.touches.some((touch) => touch.mcUsername === "bravo")).toBe(false);
    expect(
      left.session.touches.find((touch) => touch.mcUsername === "alpha")?.lastAt,
    ).toBe(tLeave);

    const stillTrailing = applyLobbyMateTouch({
      previous: left.session,
      accountId: "a1",
      mcUsername: "jc_treepuncher",
      lobby: null,
      location: null,
      currentMates: [],
      trailingMatesByLobby: { M1B: ["alpha"] },
      at: tTrail,
      inPit: false,
    });
    expect(stillTrailing.ended).toBe(false);
    expect(
      stillTrailing.session.touches.find((touch) => touch.mcUsername === "alpha")?.lastAt,
    ).toBe(tTrail);

    const closed = applyLobbyMateTouch({
      previous: stillTrailing.session,
      accountId: "a1",
      mcUsername: "jc_treepuncher",
      lobby: null,
      location: null,
      currentMates: [],
      trailingMatesByLobby: {},
      at: tDone,
      inPit: false,
    });
    expect(closed.ended).toBe(true);
    expect(closed.shouldPost).toBe(true);
    expect(closed.session.trailing).toHaveLength(0);
  });
});

describe("refreshTouchesStillInLobby", () => {
  it("extends lastAt only for names still present", () => {
    const touches = refreshTouchesStillInLobby(
      [
        {
          mcUsername: "alpha",
          lobby: "M1B",
          firstAt: "2026-07-25T02:00:00.000Z",
          lastAt: "2026-07-25T02:00:00.000Z",
        },
        {
          mcUsername: "gone",
          lobby: "M1B",
          firstAt: "2026-07-25T02:00:00.000Z",
          lastAt: "2026-07-25T02:00:00.000Z",
        },
      ],
      "M1B",
      ["alpha"],
      "2026-07-25T02:00:15.000Z",
    );
    expect(touches.find((touch) => touch.mcUsername === "alpha")?.lastAt).toBe(
      "2026-07-25T02:00:15.000Z",
    );
    expect(touches.find((touch) => touch.mcUsername === "gone")?.lastAt).toBe(
      "2026-07-25T02:00:00.000Z",
    );
  });
});

describe("txt + notice helpers", () => {
  it("builds a txt log with time ranges and an IGN-labeled filename", () => {
    const session = {
      accountId: "a1",
      mcUsername: "jc_treepuncher",
      startedAt: "2026-07-25T02:00:00.000Z",
      currentLobby: "M1B",
      currentLocation: "SPAWN",
      inPit: true,
      lobbies: ["M1B"],
      touches: [
        {
          mcUsername: "alpha",
          lobby: "M1B",
          firstAt: "2026-07-25T02:00:00.000Z",
          lastAt: "2026-07-25T02:00:40.000Z",
        },
      ],
      trailing: [],
      discordMessageIds: [] as string[],
      lastPostedKey: null,
    };
    const txt = buildLobbyMateTxtLog(session);
    expect(txt).toContain("jc_treepuncher · lobby mates session");
    expect(txt).toContain("M1B (1)");
    expect(txt).toContain(
      `alpha — ${formatTouchRange("2026-07-25T02:00:00.000Z", "2026-07-25T02:00:40.000Z")}`,
    );

    const filename = lobbyMateAttachmentFilename(
      "jc_treepuncher",
      "2026-07-25T02:00:00.000Z",
    );
    expect(filename.startsWith("jc_treepuncher_lobby-mates_")).toBe(true);
    expect(filename.endsWith(".txt")).toBe(true);

    const notice = buildLobbyMateDiscordNotice(session, { filename });
    expect(notice.content).toContain("`jc_treepuncher`");
    expect(notice.content).toContain(filename);
    expect(notice.content).toContain("Delete this Discord message");
  });
});
