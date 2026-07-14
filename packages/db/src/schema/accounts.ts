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
    priority: integer("priority").notNull().default(100),
    scanIntervalSeconds: integer("scan_interval_seconds").notNull().default(3600),
    nextScanAt: timestamp("next_scan_at", { withTimezone: true }).notNull(),
    lastSuccessScanAt: timestamp("last_success_scan_at", { withTimezone: true }),
    lastFailureScanAt: timestamp("last_failure_scan_at", { withTimezone: true }),
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
  }),
);

export type AccountRow = typeof accounts.$inferSelect;
export type NewAccountRow = typeof accounts.$inferInsert;
