import { sql } from "drizzle-orm";
import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts.js";

export const scanStatusEnum = pgEnum("scan_status", [
  "queued",
  "running",
  "success",
  "failure",
  "cancelled",
]);

export const scanTriggeredByEnum = pgEnum("scan_triggered_by", [
  "schedule",
  "manual",
  "retry",
]);

export const scanProcessingStatusEnum = pgEnum("scan_processing_status", [
  "pending",
  "processed",
  "failed",
  "skipped",
]);

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    status: scanStatusEnum("status").notNull().default("queued"),
    triggeredBy: scanTriggeredByEnum("triggered_by").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    rawInventoryHash: text("raw_inventory_hash"),
    rawInventory: jsonb("raw_inventory").$type<Record<string, unknown> | null>(),
    itemCount: integer("item_count"),
    processingStatus: scanProcessingStatusEnum("processing_status").notNull().default("pending"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    idempotencyUnique: uniqueIndex("scans_idempotency_key_unique").on(table.idempotencyKey),
    accountCreatedIdx: index("scans_account_created_idx").on(table.accountId, table.createdAt),
    statusProcessingIdx: index("scans_status_processing_idx").on(
      table.status,
      table.processingStatus,
    ),
    successDupIdx: uniqueIndex("scans_success_content_unique")
      .on(table.accountId, table.observedAt, table.rawInventoryHash)
      .where(sql`status = 'success' AND raw_inventory_hash IS NOT NULL`),
  }),
);

export type ScanRow = typeof scans.$inferSelect;
export type NewScanRow = typeof scans.$inferInsert;
