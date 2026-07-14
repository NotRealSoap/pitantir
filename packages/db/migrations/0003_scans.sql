CREATE TYPE "public"."scan_status" AS ENUM('queued', 'running', 'success', 'failure', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."scan_triggered_by" AS ENUM('schedule', 'manual', 'retry');--> statement-breakpoint
CREATE TYPE "public"."scan_processing_status" AS ENUM('pending', 'processed', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"status" "scan_status" DEFAULT 'queued' NOT NULL,
	"triggered_by" "scan_triggered_by" NOT NULL,
	"idempotency_key" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"observed_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"raw_inventory_hash" text,
	"raw_inventory" jsonb,
	"item_count" integer,
	"processing_status" "scan_processing_status" DEFAULT 'pending' NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scans_idempotency_key_unique" ON "scans" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "scans_account_created_idx" ON "scans" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "scans_status_processing_idx" ON "scans" USING btree ("status","processing_status");--> statement-breakpoint
CREATE UNIQUE INDEX "scans_success_content_unique" ON "scans" USING btree ("account_id","observed_at","raw_inventory_hash") WHERE status = 'success' AND raw_inventory_hash IS NOT NULL;
