ALTER TABLE "accounts" ADD COLUMN "last_hypixel_online" boolean;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_hypixel_online_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_presence_source" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_session_game" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_inventory_hash" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_inventory_changed_at" timestamp with time zone;--> statement-breakpoint
INSERT INTO "admin_settings" ("key", "value", "updated_at")
VALUES ('hypixel_live_events', '[]'::jsonb, NOW())
ON CONFLICT ("key") DO NOTHING;
