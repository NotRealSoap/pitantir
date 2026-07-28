import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";
import { getHypixelScansPaused, setHypixelScansPaused } from "./scan-control.js";
import { getHypixelRateLimitSnapshot } from "./hypixel-usage.js";
import { notifyHypixelApiOutage } from "./discord-webhook.js";

export const HYPIXEL_API_CIRCUIT_KEY = "hypixel_api_circuit";
export const HYPIXEL_API_FAILURE_THRESHOLD = 3;

export type HypixelApiCircuitState = {
  consecutiveFailures: number;
  trippedAt: string | null;
  alertSentAt: string | null;
  lastFailureAt: string | null;
  lastFailureDetail: string | null;
};

const EMPTY_STATE: HypixelApiCircuitState = {
  consecutiveFailures: 0,
  trippedAt: null,
  alertSentAt: null,
  lastFailureAt: null,
  lastFailureDetail: null,
};

function normalizeCircuit(value: unknown): HypixelApiCircuitState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_STATE };
  }
  const row = value as Record<string, unknown>;
  return {
    consecutiveFailures:
      typeof row.consecutiveFailures === "number" && Number.isFinite(row.consecutiveFailures)
        ? Math.max(0, Math.floor(row.consecutiveFailures))
        : 0,
    trippedAt: typeof row.trippedAt === "string" ? row.trippedAt : null,
    alertSentAt: typeof row.alertSentAt === "string" ? row.alertSentAt : null,
    lastFailureAt: typeof row.lastFailureAt === "string" ? row.lastFailureAt : null,
    lastFailureDetail:
      typeof row.lastFailureDetail === "string" ? row.lastFailureDetail : null,
  };
}

async function writeCircuit(db: Database, state: HypixelApiCircuitState): Promise<void> {
  const existing = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, HYPIXEL_API_CIRCUIT_KEY))
    .limit(1);
  if (existing[0]) {
    await db
      .update(adminSettings)
      .set({ value: state, updatedAt: now() })
      .where(eq(adminSettings.key, HYPIXEL_API_CIRCUIT_KEY));
    return;
  }
  await db.insert(adminSettings).values({
    key: HYPIXEL_API_CIRCUIT_KEY,
    value: state,
    updatedAt: now(),
  });
}

export async function getHypixelApiCircuit(db: Database): Promise<HypixelApiCircuitState> {
  const rows = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, HYPIXEL_API_CIRCUIT_KEY))
    .limit(1);
  return normalizeCircuit(rows[0]?.value);
}

export async function isHypixelApiCircuitOpen(db: Database): Promise<boolean> {
  const state = await getHypixelApiCircuit(db);
  return Boolean(state.trippedAt);
}

export async function clearHypixelApiCircuit(db: Database): Promise<void> {
  await writeCircuit(db, { ...EMPTY_STATE });
}

/**
 * Record a Hypixel HTTP outcome. After {@link HYPIXEL_API_FAILURE_THRESHOLD}
 * consecutive failures, pauses scheduled/manual Hypixel work and pings Discord ops once.
 *
 * Rate limits (HTTP 429) do **not** trip the circuit — they are expected under load and
 * should back off via quota pacing, not lock the operator out until a manual Resume.
 */
export async function handleHypixelApiCallOutcome(
  db: Database,
  outcome: {
    ok: boolean;
    detail?: string | null;
    endpoint?: string | null;
    statusCode?: number | null;
  },
): Promise<{ consecutiveFailures: number; tripped: boolean; alreadyOpen: boolean }> {
  const current = await getHypixelApiCircuit(db);
  const alreadyOpen = Boolean(current.trippedAt);

  if (outcome.ok) {
    if (current.consecutiveFailures === 0 && !alreadyOpen) {
      return { consecutiveFailures: 0, tripped: false, alreadyOpen };
    }
    // Success while healthy resets the streak. While tripped, leave the open
    // circuit alone until an operator resumes (success should not auto-resume).
    if (!alreadyOpen) {
      await writeCircuit(db, { ...EMPTY_STATE });
    }
    return {
      consecutiveFailures: alreadyOpen ? current.consecutiveFailures : 0,
      tripped: false,
      alreadyOpen,
    };
  }

    // Soft failures: quota exhaustion / rate limit — record detail but do not trip.
  if (isHypixelRateLimitOutcome(outcome)) {
    const at = new Date().toISOString();
    await writeCircuit(db, {
      ...current,
      lastFailureAt: at,
      lastFailureDetail: formatOutcomeDetail(outcome) || "Hypixel rate limited",
    });
    return {
      consecutiveFailures: current.consecutiveFailures,
      tripped: false,
      alreadyOpen,
    };
  }

  const at = new Date().toISOString();
  const detail = formatOutcomeDetail(outcome) || "Hypixel request failed";

  const consecutiveFailures = current.consecutiveFailures + 1;
  const next: HypixelApiCircuitState = {
    ...current,
    consecutiveFailures,
    lastFailureAt: at,
    lastFailureDetail: detail,
  };

  let tripped = false;
  if (!alreadyOpen && consecutiveFailures >= HYPIXEL_API_FAILURE_THRESHOLD) {
    next.trippedAt = at;
    tripped = true;
    await setHypixelScansPaused(db, true);
    if (!next.alertSentAt) {
      const alerted = await notifyHypixelApiOutage(db, {
        consecutiveFailures,
        detail,
        at,
      }).catch(() => false);
      if (alerted) {
        next.alertSentAt = at;
      }
    }
  }

  await writeCircuit(db, next);
  return { consecutiveFailures, tripped, alreadyOpen };
}

function formatOutcomeDetail(outcome: {
  detail?: string | null;
  endpoint?: string | null;
  statusCode?: number | null;
}): string {
  return [
    outcome.endpoint ? `${outcome.endpoint}` : null,
    outcome.statusCode != null ? `HTTP ${outcome.statusCode}` : null,
    outcome.detail?.trim() || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** True when the failure is quota / rate-limit (not a hard outage). */
export function isHypixelRateLimitOutcome(outcome: {
  detail?: string | null;
  statusCode?: number | null;
}): boolean {
  if (outcome.statusCode === 429) return true;
  const detail = (outcome.detail ?? "").toLowerCase();
  return (
    detail.includes("rate limit") ||
    detail.includes("rate limited") ||
    detail.includes("upstream_rate_limited")
  );
}

/**
 * If the circuit was tripped by rate limits and the observed quota window has
 * reset, clear the pause so scanning can resume without a manual click.
 */
export async function maybeAutoResumeAfterRateLimitWindow(
  db: Database,
  asOf: Date = now(),
): Promise<boolean> {
  const [paused, circuit, snapshot] = await Promise.all([
    getHypixelScansPaused(db),
    getHypixelApiCircuit(db),
    getHypixelRateLimitSnapshot(db),
  ]);
  if (!paused || !circuit.trippedAt) return false;

  const detail = circuit.lastFailureDetail ?? "";
  const rateLimited =
    isHypixelRateLimitOutcome({ detail, statusCode: null }) || /\b429\b/.test(detail);
  if (!rateLimited) return false;

  // No snapshot: allow resume after the trip has aged a bit (avoid instant loops).
  if (!snapshot) {
    const trippedMs = Date.parse(circuit.trippedAt);
    if (!Number.isFinite(trippedMs) || asOf.getTime() - trippedMs < 60_000) {
      return false;
    }
  } else {
    const resetAt = new Date(
      new Date(snapshot.observedAt).getTime() + snapshot.resetSeconds * 1000,
    );
    if (asOf.getTime() < resetAt.getTime()) {
      return false;
    }
  }

  await clearHypixelApiCircuit(db);
  await setHypixelScansPaused(db, false);
  return true;
}
