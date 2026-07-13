CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mc_uuid" uuid,
	"mc_username" text NOT NULL,
	"display_name" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"scan_interval_seconds" integer DEFAULT 3600 NOT NULL,
	"next_scan_at" timestamp with time zone NOT NULL,
	"last_success_scan_at" timestamp with time zone,
	"last_failure_scan_at" timestamp with time zone,
	"credentials_encrypted" text,
	"notes" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admin_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_mc_uuid_unique" ON "accounts" USING btree ("mc_uuid") WHERE mc_uuid IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_mc_username_unique" ON "accounts" USING btree (lower("mc_username")) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "accounts_enabled_next_scan_idx" ON "accounts" USING btree ("enabled","next_scan_at") WHERE deleted_at IS NULL;