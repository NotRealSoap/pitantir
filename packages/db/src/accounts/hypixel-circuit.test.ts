import { describe, expect, it } from "vitest";
import {
  HYPIXEL_API_FAILURE_THRESHOLD,
  type HypixelApiCircuitState,
} from "./hypixel-circuit.js";
import { isDiscordUserId, OPS_ALERT_DISCORD_USERNAME } from "./discord-webhook.js";

/** Pure streak helper mirrored by handleHypixelApiCallOutcome (for unit coverage). */
function streakAfter(
  current: HypixelApiCircuitState,
  ok: boolean,
): { consecutiveFailures: number; shouldTrip: boolean } {
  if (ok) {
    return {
      consecutiveFailures: current.trippedAt ? current.consecutiveFailures : 0,
      shouldTrip: false,
    };
  }
  const consecutiveFailures = current.consecutiveFailures + 1;
  return {
    consecutiveFailures,
    shouldTrip: !current.trippedAt && consecutiveFailures >= HYPIXEL_API_FAILURE_THRESHOLD,
  };
}

describe("hypixel api circuit streak", () => {
  it("trips on the third consecutive failure", () => {
    let state: HypixelApiCircuitState = {
      consecutiveFailures: 0,
      trippedAt: null,
      alertSentAt: null,
      lastFailureAt: null,
      lastFailureDetail: null,
    };
    expect(streakAfter(state, false)).toEqual({ consecutiveFailures: 1, shouldTrip: false });
    state = { ...state, consecutiveFailures: 1 };
    expect(streakAfter(state, false)).toEqual({ consecutiveFailures: 2, shouldTrip: false });
    state = { ...state, consecutiveFailures: 2 };
    expect(streakAfter(state, false)).toEqual({ consecutiveFailures: 3, shouldTrip: true });
  });

  it("resets streak on success while healthy", () => {
    const state: HypixelApiCircuitState = {
      consecutiveFailures: 2,
      trippedAt: null,
      alertSentAt: null,
      lastFailureAt: null,
      lastFailureDetail: null,
    };
    expect(streakAfter(state, true)).toEqual({ consecutiveFailures: 0, shouldTrip: false });
  });

  it("does not re-trip while already open", () => {
    const state: HypixelApiCircuitState = {
      consecutiveFailures: 5,
      trippedAt: "2026-07-22T00:00:00.000Z",
      alertSentAt: "2026-07-22T00:00:00.000Z",
      lastFailureAt: "2026-07-22T00:00:00.000Z",
      lastFailureDetail: "HTTP 500",
    };
    expect(streakAfter(state, false).shouldTrip).toBe(false);
    expect(streakAfter(state, true).consecutiveFailures).toBe(5);
  });
});

describe("isHypixelRateLimitOutcome", () => {
  it("treats 429 and rate-limit details as soft failures", async () => {
    const { isHypixelRateLimitOutcome } = await import("./hypixel-circuit.js");
    expect(isHypixelRateLimitOutcome({ statusCode: 429 })).toBe(true);
    expect(isHypixelRateLimitOutcome({ detail: "rate limited", statusCode: 0 })).toBe(true);
    expect(isHypixelRateLimitOutcome({ detail: "upstream_rate_limited", statusCode: null })).toBe(
      true,
    );
    expect(isHypixelRateLimitOutcome({ statusCode: 500, detail: "boom" })).toBe(false);
  });
});

describe("ops alert mention config", () => {
  it("validates Discord snowflake user IDs", () => {
    expect(isDiscordUserId("123456789012345678")).toBe(true);
    expect(isDiscordUserId("ambienangel")).toBe(false);
    expect(OPS_ALERT_DISCORD_USERNAME).toBe("ambienangel");
  });
});
