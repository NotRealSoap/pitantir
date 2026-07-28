ALTER TABLE "accounts" ADD COLUMN "last_pitpal_lobby" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_pitpal_location" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_pitpal_armor_type" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_pitpal_killstreak" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_pitpal_seen_at" timestamp with time zone;--> statement-breakpoint
INSERT INTO "admin_settings" ("key", "value", "updated_at")
VALUES ('pitpal_lobby_snapshot', '{"observedAt":null,"players":[],"source":null}'::jsonb, NOW())
ON CONFLICT ("key") DO NOTHING;
