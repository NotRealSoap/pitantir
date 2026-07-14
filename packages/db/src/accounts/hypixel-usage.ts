import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";
import type { HypixelRateLimitSnapshot } from "@pitantir/shared/inventory";

export const HYPIXEL_RATE_LIMIT_KEY = "hypixel_rate_limit";

function isSnapshot(value: unknown): value is HypixelRateLimitSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.limit === "number" &&
    typeof row.remaining === "number" &&
    typeof row.resetSeconds === "number" &&
    typeof row.observedAt === "string" &&
    typeof row.windowSeconds === "number" &&
    (row.source === "scan" || row.source === "probe")
  );
}

export async function getHypixelRateLimitSnapshot(
  db: Database,
): Promise<HypixelRateLimitSnapshot | null> {
  const rows = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, HYPIXEL_RATE_LIMIT_KEY))
    .limit(1);
  const value = rows[0]?.value;
  return isSnapshot(value) ? value : null;
}

export async function setHypixelRateLimitSnapshot(
  db: Database,
  snapshot: HypixelRateLimitSnapshot,
): Promise<void> {
  const existing = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, HYPIXEL_RATE_LIMIT_KEY))
    .limit(1);
  if (existing[0]) {
    await db
      .update(adminSettings)
      .set({ value: snapshot, updatedAt: now() })
      .where(eq(adminSettings.key, HYPIXEL_RATE_LIMIT_KEY));
    return;
  }
  await db.insert(adminSettings).values({
    key: HYPIXEL_RATE_LIMIT_KEY,
    value: snapshot,
    updatedAt: now(),
  });
}
