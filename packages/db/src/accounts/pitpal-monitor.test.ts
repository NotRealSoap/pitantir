import { describe, expect, it } from "vitest";
import {
  evaluatePitpalMonitor,
  PITPAL_MONITOR_STALE_MS,
  type PitpalMonitorState,
} from "./pitpal-monitor.js";

const empty: PitpalMonitorState = {
  status: "unknown",
  lastCheckedAt: null,
  lastIngestAt: null,
  offlineSince: null,
  lastTransitionAt: null,
  lastAlertAt: null,
};

describe("evaluatePitpalMonitor", () => {
  const nowMs = Date.parse("2026-07-23T17:00:00.000Z");
  const freshAt = new Date(nowMs - 30_000).toISOString();
  const staleAt = new Date(nowMs - PITPAL_MONITOR_STALE_MS - 5_000).toISOString();

  it("alerts offline on first check when there is no ingest", () => {
    const result = evaluatePitpalMonitor({
      observedAt: null,
      previous: empty,
      nowMs,
    });
    expect(result.transition).toBe("went_offline");
    expect(result.next.status).toBe("offline");
    expect(result.feedFresh).toBe(false);
  });

  it("stays silent on first check when ingest is fresh", () => {
    const result = evaluatePitpalMonitor({
      observedAt: freshAt,
      previous: empty,
      nowMs,
    });
    expect(result.transition).toBeNull();
    expect(result.next.status).toBe("online");
    expect(result.feedFresh).toBe(true);
  });

  it("alerts when a fresh feed goes stale", () => {
    const previous: PitpalMonitorState = {
      ...empty,
      status: "online",
      lastIngestAt: freshAt,
    };
    const result = evaluatePitpalMonitor({
      observedAt: staleAt,
      previous,
      nowMs,
    });
    expect(result.transition).toBe("went_offline");
    expect(result.next.status).toBe("offline");
    expect(result.next.offlineSince).toBeTruthy();
  });

  it("alerts when monitoring resumes", () => {
    const previous: PitpalMonitorState = {
      ...empty,
      status: "offline",
      offlineSince: staleAt,
      lastIngestAt: staleAt,
    };
    const result = evaluatePitpalMonitor({
      observedAt: freshAt,
      previous,
      nowMs,
    });
    expect(result.transition).toBe("came_online");
    expect(result.next.status).toBe("online");
    expect(result.next.offlineSince).toBeNull();
  });

  it("does not re-alert while remaining offline", () => {
    const previous: PitpalMonitorState = {
      ...empty,
      status: "offline",
      offlineSince: staleAt,
      lastIngestAt: staleAt,
    };
    const result = evaluatePitpalMonitor({
      observedAt: staleAt,
      previous,
      nowMs,
    });
    expect(result.transition).toBeNull();
    expect(result.next.status).toBe("offline");
    expect(result.next.offlineSince).toBe(staleAt);
  });
});
