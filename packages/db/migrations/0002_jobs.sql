CREATE TYPE "public"."job_status" AS ENUM('pending', 'leased', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"leased_by" text,
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "jobs_pending_claim_idx" ON "jobs" USING btree ("status","run_at","priority") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_key_unique" ON "jobs" USING btree ("idempotency_key");
