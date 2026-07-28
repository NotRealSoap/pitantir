import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";

export const INVENTORY_SOURCE_STATUS_KEY = "inventory_source_status";

export type InventorySourceStatus = {
  mode: string;
  activeSource: string;
  activeSince: string;
  lastSuccessSource: string | null;
  lastSuccessAt: string | null;
  lastFallbackSource: string | null;
  lastFallbackAt: string | null;
  detail: string | null;
};

function isInventorySourceStatus(value: unknown): value is InventorySourceStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.mode === "string" &&
    typeof row.activeSource === "string" &&
    typeof row.activeSince === "string"
  );
}

export async function getInventorySourceStatus(
  db: Database,
): Promise<InventorySourceStatus | null> {
  const rows = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, INVENTORY_SOURCE_STATUS_KEY))
    .limit(1);
  const value = rows[0]?.value;
  return isInventorySourceStatus(value) ? value : null;
}

export async function setInventorySourceStatus(
  db: Database,
  status: InventorySourceStatus,
): Promise<void> {
  const existing = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, INVENTORY_SOURCE_STATUS_KEY))
    .limit(1);
  if (existing[0]) {
    await db
      .update(adminSettings)
      .set({ value: status, updatedAt: now() })
      .where(eq(adminSettings.key, INVENTORY_SOURCE_STATUS_KEY));
    return;
  }
  await db.insert(adminSettings).values({
    key: INVENTORY_SOURCE_STATUS_KEY,
    value: status,
    updatedAt: now(),
  });
}
