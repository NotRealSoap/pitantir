ALTER TABLE "accounts" ADD COLUMN "watchlisted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Manual / previously enabled accounts become the Hypixel refresh roster.
UPDATE "accounts"
SET "watchlisted" = true
WHERE "deleted_at" IS NULL
  AND "enabled" = true
  AND ("notes" IS NULL OR "notes" NOT LIKE 'auto:%');--> statement-breakpoint
CREATE INDEX "accounts_watchlisted_enabled_next_scan_idx"
  ON "accounts" USING btree ("watchlisted", "enabled", "next_scan_at")
  WHERE "deleted_at" IS NULL;--> statement-breakpoint
INSERT INTO "admin_settings" ("key", "value", "updated_at")
VALUES ('hypixel_scans_paused', 'false'::jsonb, NOW())
ON CONFLICT ("key") DO NOTHING;
