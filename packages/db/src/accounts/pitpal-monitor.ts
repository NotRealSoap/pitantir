import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";
import { getPitpalLobbySnapshot } from "./pitpal-lobbies.js";
import { notifyPitpalMonitorStatus } from "./discord-webhook.js";

export const PITPAL_MONITOR_STATE_KEY = "pitpal_monitor_heartbeat";

/**
 * No successful lobby ingest within this window → monitoring is "offline".
 * Longer than PITPAL_FRESH_MS (90s) so brief blips don't flap Discord.
 */
export const PITPAL_MONITOR_STALE_MS = 3 * 60_000;

export type PitpalMonitorStatus = "online" | "offline" | "unknown";

export type PitpalMonitorState = {
  status: PitpalMonitorStatus;
  lastCheckedAt: string | null;
  lastIngestAt: string | null;
  offlineSince: string | null;
  lastTransitionAt: string | null;
  lastAlertAt: string | null;
};

const EMPTY_STATE: PitpalMonitorState = {
  status: "unknown",
  lastCheckedAt: null,
  lastIngestAt: null,
  offlineSince: null,
  lastTransitionAt: null,
  lastAlertAt: null,
};

function normalizeState(value: unknown): PitpalMonitorState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_STATE };
  }
  const row = value as Record<string, unknown>;
  const status =
    row.status === "online" || row.status === "offline" || row.status === "unknown"
      ? row.status
      : "unknown";
  return {
    status,
    lastCheckedAt: typeof row.lastCheckedAt === "string" ? row.lastCheckedAt : null,
    lastIngestAt: typeof row.lastIngestAt === "string" ? row.lastIngestAt : null,
    offlineSince: typeof row.offlineSince === "string" ? row.offlineSince : null,
    lastTransitionAt: typeof row.lastTransitionAt === "string" ? row.lastTransitionAt : null,
    lastAlertAt: typeof row.lastAlertAt === "string" ? row.lastAlertAt : null,
  };
}

async function writeState(db: Database, state: PitpalMonitorState): Promise<void> {
  const existing = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, PITPAL_MONITOR_STATE_KEY))
    .limit(1);
  if (existing[0]) {
    await db
      .update(adminSettings)
      .set({ value: state, updatedAt: now() })
      .where(eq(adminSettings.key, PITPAL_MONITOR_STATE_KEY));
    return;
  }
  await db.insert(adminSettings).values({
    key: PITPAL_MONITOR_STATE_KEY,
    value: state,
    updatedAt: now(),
  });
}

export async function getPitpalMonitorState(db: Database): Promise<PitpalMonitorState> {
  const rows = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, PITPAL_MONITOR_STATE_KEY))
    .limit(1);
  return normalizeState(rows[0]?.value);
}

export type PitpalMonitorEvaluation = {
  next: PitpalMonitorState;
  transition: "went_offline" | "came_online" | null;
  feedFresh: boolean;
  ageMs: number | null;
};

/**
 * Pure transition helper — unit-tested without Discord/DB.
 *
 * - unknown → offline: alert (never ingested / already stale)
 * - unknown → online: silent (first good sighting after deploy)
 * - online → offline / offline → online: alert
 */
export function evaluatePitpalMonitor(input: {
  observedAt: string | null;
  previous: PitpalMonitorState;
  nowMs?: number;
  staleMs?: number;
}): PitpalMonitorEvaluation {
  const nowMs = input.nowMs ?? Date.now();
  const staleMs = input.staleMs ?? PITPAL_MONITOR_STALE_MS;
  const checkedAt = new Date(nowMs).toISOString();

  let ageMs: number | null = null;
  let feedFresh = false;
  if (input.observedAt) {
    const at = Date.parse(input.observedAt);
    if (Number.isFinite(at)) {
      ageMs = Math.max(0, nowMs - at);
      feedFresh = ageMs <= staleMs;
    }
  }

  const desired: PitpalMonitorStatus = feedFresh ? "online" : "offline";
  const previous = input.previous;
  let transition: PitpalMonitorEvaluation["transition"] = null;

  if (previous.status === "unknown") {
    if (desired === "offline") transition = "went_offline";
  } else if (previous.status !== desired) {
    transition = desired === "offline" ? "went_offline" : "came_online";
  }

  const next: PitpalMonitorState = {
    status: desired,
    lastCheckedAt: checkedAt,
    lastIngestAt: input.observedAt,
    offlineSince:
      desired === "offline"
        ? previous.status === "offline" && previous.offlineSince
          ? previous.offlineSince
          : checkedAt
        : null,
    lastTransitionAt: transition ? checkedAt : previous.lastTransitionAt,
    lastAlertAt: previous.lastAlertAt,
  };

  return { next, transition, feedFresh, ageMs };
}

export type CheckPitpalMonitorResult = {
  status: PitpalMonitorStatus;
  transition: "went_offline" | "came_online" | null;
  alerted: boolean;
  ageMs: number | null;
  staleMs: number;
};

/**
 * Compare the latest lobby snapshot age to the stale threshold and Discord-alert
 * on online↔offline transitions. Safe to call every worker tick (throttled by caller).
 */
export async function checkPitpalMonitorHeartbeat(
  db: Database,
  options?: { nowMs?: number; staleMs?: number },
): Promise<CheckPitpalMonitorResult> {
  const staleMs = options?.staleMs ?? PITPAL_MONITOR_STALE_MS;
  const nowMs = options?.nowMs ?? Date.now();
  const snapshot = await getPitpalLobbySnapshot(db);
  const previous = await getPitpalMonitorState(db);
  const evaluated = evaluatePitpalMonitor({
    observedAt: snapshot.observedAt,
    previous,
    nowMs,
    staleMs,
  });

  let alerted = false;
  if (evaluated.transition) {
    alerted = await notifyPitpalMonitorStatus(db, {
      kind: evaluated.transition,
      ageMs: evaluated.ageMs,
      staleMs,
      offlineSince: evaluated.next.offlineSince,
      lastIngestAt: evaluated.next.lastIngestAt,
      at: evaluated.next.lastTransitionAt ?? new Date(nowMs).toISOString(),
    });
    if (alerted) {
      evaluated.next.lastAlertAt = evaluated.next.lastTransitionAt;
    }
  }

  await writeState(db, evaluated.next);
  return {
    status: evaluated.next.status,
    transition: evaluated.transition,
    alerted,
    ageMs: evaluated.ageMs,
    staleMs,
  };
}
