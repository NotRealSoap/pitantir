#!/usr/bin/env npx tsx
/**
 * Dump one raw inventory item from the latest successful scan.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx pnpm@10.11.0 --filter @pitantir/worker dump-scan-item -- billionaire
 *   DATABASE_URL=... npx pnpm@10.11.0 --filter @pitantir/worker dump-scan-item -- lifesteal --all
 */
import postgres from "postgres";

const needle = (process.argv[2] ?? "billionaire").toLowerCase();
const showAll = process.argv.includes("--all");
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });

type ScanRow = {
  id: string;
  item_count: number | null;
  observed_at: Date | null;
  mc_username: string;
  raw_inventory: Record<string, unknown> | null;
};

function collectSlots(raw: Record<string, unknown>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const key of ["inventory", "ender_chest", "enderChest"] as const) {
    const value = raw[key];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry && typeof entry === "object") {
          out.push({ container: key, ...(entry as Record<string, unknown>) });
        }
      }
    }
  }
  if (Array.isArray(raw.containers)) {
    for (const container of raw.containers) {
      if (!container || typeof container !== "object") continue;
      const record = container as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "container";
      if (!Array.isArray(record.slots)) continue;
      for (const entry of record.slots) {
        if (entry && typeof entry === "object") {
          out.push({ container: name, ...(entry as Record<string, unknown>) });
        }
      }
    }
  }
  return out;
}

function itemText(item: Record<string, unknown>): string {
  return JSON.stringify(item).toLowerCase();
}

const rows = (await sql`
  SELECT s.id, s.item_count, s.observed_at, a.mc_username, s.raw_inventory
  FROM scans s
  JOIN accounts a ON a.id = s.account_id
  WHERE s.status = 'success' AND s.raw_inventory IS NOT NULL
  ORDER BY s.created_at DESC
  LIMIT 5
`) as unknown as ScanRow[];

if (rows.length === 0) {
  console.error("No successful scans with raw inventory found.");
  await sql.end();
  process.exit(1);
}

const scan = rows[0]!;
const slots = collectSlots(scan.raw_inventory ?? {});
const matches = slots.filter((slot) => itemText(slot).includes(needle));

const payload = {
  scanId: scan.id,
  account: scan.mc_username,
  observedAt: scan.observed_at,
  itemCount: scan.item_count,
  totalSlotsStored: slots.length,
  needle,
  matchCount: matches.length,
  note: "Mystic fields: kind, lore, customEnchants, nonce. Example sword = title + customEnchants + nonce.",
  sampleTitles: slots.slice(0, 20).map((slot) => ({
    container: slot.container,
    slot: slot.slot,
    id: slot.id ?? slot.type,
    title: slot.title,
    nonce: slot.nonce,
    customEnchants: slot.customEnchants ?? null,
    extraKeys:
      slot.hypixelExtraAttributes && typeof slot.hypixelExtraAttributes === "object"
        ? Object.keys(slot.hypixelExtraAttributes as Record<string, unknown>)
        : [],
  })),
  matches: showAll ? matches : matches.slice(0, 1),
  fallbackFirstItem: matches.length === 0 ? (slots[0] ?? null) : undefined,
};

console.log(JSON.stringify(payload, null, 2));

await sql.end();
