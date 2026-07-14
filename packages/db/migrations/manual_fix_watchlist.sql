-- One-shot repair if drizzle said "success" but watchlisted is still missing
-- (e.g. migrate hit a different DATABASE_URL than the Next app).
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "watchlisted" boolean DEFAULT false NOT NULL;

UPDATE "accounts"
SET "watchlisted" = true
WHERE "deleted_at" IS NULL
  AND "enabled" = true
  AND ("notes" IS NULL OR "notes" NOT LIKE 'auto:%')
  AND "watchlisted" = false;

CREATE INDEX IF NOT EXISTS "accounts_watchlisted_enabled_next_scan_idx"
  ON "accounts" USING btree ("watchlisted", "enabled", "next_scan_at")
  WHERE "deleted_at" IS NULL;

INSERT INTO "admin_settings" ("key", "value", "updated_at")
VALUES ('hypixel_scans_paused', 'false'::jsonb, NOW())
ON CONFLICT ("key") DO NOTHING;
