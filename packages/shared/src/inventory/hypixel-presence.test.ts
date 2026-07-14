import { describe, expect, it } from "vitest";
import {
  presenceFromPlayerLoginLogout,
  presenceFromStatusResponse,
} from "./hypixel-presence.js";

describe("presenceFromPlayerLoginLogout", () => {
  it("marks online when lastLogin is newer than lastLogout", () => {
    const presence = presenceFromPlayerLoginLogout({
      lastLogin: Date.parse("2026-07-14T04:00:00.000Z"),
      lastLogout: Date.parse("2026-07-14T03:00:00.000Z"),
    });
    expect(presence.online).toBe(true);
    expect(presence.source).toBe("login_logout");
  });

  it("marks offline when lastLogout is newer", () => {
    const presence = presenceFromPlayerLoginLogout({
      lastLogin: Date.parse("2026-07-14T02:00:00.000Z"),
      lastLogout: Date.parse("2026-07-14T03:00:00.000Z"),
    });
    expect(presence.online).toBe(false);
  });
});

describe("presenceFromStatusResponse", () => {
  it("reads session.online and game metadata", () => {
    const presence = presenceFromStatusResponse({
      success: true,
      session: { online: true, gameType: "PIT", mode: "pit", map: "The Pit" },
    });
    expect(presence).toMatchObject({
      online: true,
      source: "status",
      gameType: "PIT",
      mode: "pit",
      map: "The Pit",
    });
  });
});
