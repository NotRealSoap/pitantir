import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";

export const HYPIXEL_API_CALLS_KEY = "hypixel_api_calls";
const MAX_CALLS = 50;

export interface HypixelApiCall {
  id: string;
  at: string;
  /** Short endpoint label, e.g. player / status / punishmentstats */
  endpoint: string;
  accountId?: string | null;
  mcUsername?: string | null;
  ok: boolean;
  statusCode?: number | null;
  detail?: string | null;
}

function isCall(value: unknown): value is HypixelApiCall {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.at === "string" &&
    typeof row.endpoint === "string" &&
    typeof row.ok === "boolean"
  );
}

export async function getHypixelApiCalls(db: Database): Promise<HypixelApiCall[]> {
  const rows = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, HYPIXEL_API_CALLS_KEY))
    .limit(1);
  const value = rows[0]?.value;
  if (!Array.isArray(value)) return [];
  return value.filter(isCall);
}

export async function appendHypixelApiCall(
  db: Database,
  call: HypixelApiCall,
): Promise<HypixelApiCall[]> {
  const existing = await getHypixelApiCalls(db);
  const next = [call, ...existing].slice(0, MAX_CALLS);
  const current = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, HYPIXEL_API_CALLS_KEY))
    .limit(1);
  if (current[0]) {
    await db
      .update(adminSettings)
      .set({ value: next, updatedAt: now() })
      .where(eq(adminSettings.key, HYPIXEL_API_CALLS_KEY));
  } else {
    await db.insert(adminSettings).values({
      key: HYPIXEL_API_CALLS_KEY,
      value: next,
      updatedAt: now(),
    });
  }
  return next;
}
