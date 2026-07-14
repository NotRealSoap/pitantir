import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";

export const HYPIXEL_LIVE_EVENTS_KEY = "hypixel_live_events";
const MAX_EVENTS = 40;

export type LiveEventKind = "came_online" | "went_offline" | "inventory_changed" | "scanned";

export interface HypixelLiveEvent {
  id: string;
  kind: LiveEventKind;
  accountId: string;
  mcUsername: string;
  at: string;
  detail?: string | null;
}

function isLiveEvent(value: unknown): value is HypixelLiveEvent {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.kind === "string" &&
    typeof row.accountId === "string" &&
    typeof row.mcUsername === "string" &&
    typeof row.at === "string"
  );
}

export async function getHypixelLiveEvents(db: Database): Promise<HypixelLiveEvent[]> {
  const rows = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, HYPIXEL_LIVE_EVENTS_KEY))
    .limit(1);
  const value = rows[0]?.value;
  if (!Array.isArray(value)) return [];
  return value.filter(isLiveEvent);
}

export async function appendHypixelLiveEvents(
  db: Database,
  events: HypixelLiveEvent[],
): Promise<HypixelLiveEvent[]> {
  if (events.length === 0) return getHypixelLiveEvents(db);
  const existing = await getHypixelLiveEvents(db);
  const next = [...events, ...existing].slice(0, MAX_EVENTS);

  const current = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, HYPIXEL_LIVE_EVENTS_KEY))
    .limit(1);
  if (current[0]) {
    await db
      .update(adminSettings)
      .set({ value: next, updatedAt: now() })
      .where(eq(adminSettings.key, HYPIXEL_LIVE_EVENTS_KEY));
  } else {
    await db.insert(adminSettings).values({
      key: HYPIXEL_LIVE_EVENTS_KEY,
      value: next,
      updatedAt: now(),
    });
  }
  return next;
}
