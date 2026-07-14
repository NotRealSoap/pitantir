import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";

export const HYPIXEL_SCANS_PAUSED_KEY = "hypixel_scans_paused";

export async function getHypixelScansPaused(db: Database): Promise<boolean> {
  const rows = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, HYPIXEL_SCANS_PAUSED_KEY))
    .limit(1);
  const value = rows[0]?.value;
  return value === true || value === "true";
}

export async function setHypixelScansPaused(db: Database, paused: boolean): Promise<void> {
  const existing = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, HYPIXEL_SCANS_PAUSED_KEY))
    .limit(1);
  if (existing[0]) {
    await db
      .update(adminSettings)
      .set({ value: paused, updatedAt: now() })
      .where(eq(adminSettings.key, HYPIXEL_SCANS_PAUSED_KEY));
    return;
  }
  await db.insert(adminSettings).values({
    key: HYPIXEL_SCANS_PAUSED_KEY,
    value: paused,
    updatedAt: now(),
  });
}
