import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";
import { setHypixelScansPaused } from "./scan-control.js";
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

  const at = new Date().toISOString();
  const detailParts = [
    outcome.endpoint ? `${outcome.endpoint}` : null,
    outcome.statusCode != null ? `HTTP ${outcome.statusCode}` : null,
    outcome.detail?.trim() || null,
  ].filter(Boolean);
  const detail = detailParts.join(" · ") || "Hypixel request failed";

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
