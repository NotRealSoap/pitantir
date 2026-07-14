import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "leased",
  "done",
  "failed",
  "cancelled",
]);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    status: jobStatusEnum("status").notNull().default("pending"),
    priority: integer("priority").notNull().default(100),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    leasedBy: text("leased_by"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pendingClaimIdx: index("jobs_pending_claim_idx")
      .on(table.status, table.runAt, table.priority)
      .where(sql`status = 'pending'`),
    idempotencyUnique: uniqueIndex("jobs_idempotency_key_unique").on(table.idempotencyKey),
  }),
);

export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
