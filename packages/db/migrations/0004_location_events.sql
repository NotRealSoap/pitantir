CREATE TYPE "public"."location_event_type" AS ENUM('seen', 'disappeared', 'unknown_started', 'move_confirmed', 'move_uncertain', 'contradiction', 'import_presence', 'manual_correction');--> statement-breakpoint
CREATE TABLE "item_location_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"event_type" "location_event_type" NOT NULL,
	"from_account_id" uuid,
	"to_account_id" uuid,
	"event_time" timestamp with time zone NOT NULL,
	"certainty" text NOT NULL,
	"scan_id" uuid,
	"observation_id" uuid,
	"period_id" uuid,
	"idempotency_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_location_events" ADD CONSTRAINT "item_location_events_item_id_canonical_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."canonical_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_location_events_idempotency_unique" ON "item_location_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "item_location_events_item_time_idx" ON "item_location_events" USING btree ("item_id","event_time");
