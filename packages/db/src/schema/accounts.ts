import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const adminSettings = pgTable("admin_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey(),
    mcUuid: uuid("mc_uuid"),
    mcUsername: text("mc_username").notNull(),
    displayName: text("display_name"),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * Hypixel refresh roster membership (primary site function).
     * Ownership-contact / shadow IGNs stay false so they never consume scan quota.
     */
    watchlisted: boolean("watchlisted").notNull().default(false),
    priority: integer("priority").notNull().default(100),
    scanIntervalSeconds: integer("scan_interval_seconds").notNull().default(3600),
    nextScanAt: timestamp("next_scan_at", { withTimezone: true }).notNull(),
    lastSuccessScanAt: timestamp("last_success_scan_at", { withTimezone: true }),
    lastFailureScanAt: timestamp("last_failure_scan_at", { withTimezone: true }),
    /** Best-effort Hypixel online flag from the latest successful scan. */
    lastHypixelOnline: boolean("last_hypixel_online"),
    lastHypixelOnlineAt: timestamp("last_hypixel_online_at", { withTimezone: true }),
    lastPresenceSource: text("last_presence_source"),
    lastSessionGame: text("last_session_game"),
    lastInventoryHash: text("last_inventory_hash"),
    lastInventoryChangedAt: timestamp("last_inventory_changed_at", { withTimezone: true }),
    /** PitPal lobby monitor (Tampermonkey ingest). */
    lastPitpalLobby: text("last_pitpal_lobby"),
    lastPitpalLocation: text("last_pitpal_location"),
    lastPitpalArmorType: text("last_pitpal_armor_type"),
    lastPitpalKillstreak: integer("last_pitpal_killstreak"),
    lastPitpalSeenAt: timestamp("last_pitpal_seen_at", { withTimezone: true }),
    lastPitpalIsNicked: boolean("last_pitpal_is_nicked"),
    credentialsEncrypted: text("credentials_encrypted"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    mcUuidUnique: uniqueIndex("accounts_mc_uuid_unique")
      .on(table.mcUuid)
      .where(sql`mc_uuid IS NOT NULL AND deleted_at IS NULL`),
    usernameUnique: uniqueIndex("accounts_mc_username_unique")
      .on(sql`lower(${table.mcUsername})`)
      .where(sql`deleted_at IS NULL`),
    enabledNextScanIdx: index("accounts_enabled_next_scan_idx")
      .on(table.enabled, table.nextScanAt)
      .where(sql`deleted_at IS NULL`),
    watchlistScanIdx: index("accounts_watchlisted_enabled_next_scan_idx")
      .on(table.watchlisted, table.enabled, table.nextScanAt)
      .where(sql`deleted_at IS NULL`),
  }),
);

export type AccountRow = typeof accounts.$inferSelect;
export type NewAccountRow = typeof accounts.$inferInsert;
