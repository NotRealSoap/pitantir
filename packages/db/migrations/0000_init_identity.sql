CREATE TYPE "public"."decision_type" AS ENUM('auto_resolve', 'manual_resolve', 'unlink', 'create_item', 'merge', 'split', 'invalidate_identifier', 'link_import', 'reject_import', 'correct_location', 'revert');--> statement-breakpoint
CREATE TYPE "public"."identifier_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."identifier_kind" AS ENUM('nonce', 'strict_fingerprint', 'loose_fingerprint', 'external_ref', 'manual_tag', 'legacy_id');--> statement-breakpoint
CREATE TYPE "public"."identity_confidence" AS ENUM('high', 'medium', 'low', 'contested');--> statement-breakpoint
CREATE TYPE "public"."item_category" AS ENUM('unique_nonce_candidate', 'duplicate_nonce', 'nonce_less', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('active', 'merged_away', 'split_source', 'archived');--> statement-breakpoint
CREATE TYPE "public"."resolution_status" AS ENUM('resolved', 'probable', 'ambiguous', 'unresolved', 'manually_resolved');--> statement-breakpoint
CREATE TABLE "canonical_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"category" "item_category" NOT NULL,
	"identity_confidence" "identity_confidence" NOT NULL,
	"primary_nonce" text,
	"strict_fingerprint" text,
	"loose_fingerprint" text,
	"status" "item_status" NOT NULL,
	"merged_into_item_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"decision_type" "decision_type" NOT NULL,
	"actor" text NOT NULL,
	"observation_id" uuid,
	"import_claim_id" uuid,
	"from_item_ids" uuid[] DEFAULT '{}' NOT NULL,
	"to_item_ids" uuid[] DEFAULT '{}' NOT NULL,
	"before_state" jsonb NOT NULL,
	"after_state" jsonb NOT NULL,
	"rationale" text,
	"idempotency_key" text,
	"reverts_decision_id" uuid,
	"reversed_by_decision_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_identifiers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" "identifier_kind" NOT NULL,
	"source" text,
	"value" text NOT NULL,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"identifier_confidence" "identifier_confidence" NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"invalidated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "item_location_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"account_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"start_reason" text NOT NULL,
	"end_reason" text,
	"certainty" text NOT NULL,
	"is_unknown_gap" boolean DEFAULT false NOT NULL,
	"opening_observation_id" uuid,
	"closing_observation_context_scan_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"superseded_by_period_id" uuid
);
--> statement-breakpoint
CREATE TABLE "observation_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"observation_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"score" numeric(5, 4) NOT NULL,
	"reasons" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scan_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"slot_key" text NOT NULL,
	"raw_item" jsonb NOT NULL,
	"observed_nonce" text,
	"normalized_metadata" jsonb NOT NULL,
	"strict_fingerprint" text NOT NULL,
	"loose_fingerprint" text NOT NULL,
	"canonical_item_id" uuid,
	"resolution_status" "resolution_status" NOT NULL,
	"confidence" numeric(5, 4),
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_identifiers" ADD CONSTRAINT "item_identifiers_item_id_canonical_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."canonical_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_location_periods" ADD CONSTRAINT "item_location_periods_item_id_canonical_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."canonical_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_candidates" ADD CONSTRAINT "observation_candidates_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_candidates" ADD CONSTRAINT "observation_candidates_item_id_canonical_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."canonical_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_canonical_item_id_canonical_items_id_fk" FOREIGN KEY ("canonical_item_id") REFERENCES "public"."canonical_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canonical_items_primary_nonce_idx" ON "canonical_items" USING btree ("primary_nonce");--> statement-breakpoint
CREATE INDEX "canonical_items_strict_fingerprint_idx" ON "canonical_items" USING btree ("strict_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_decisions_idempotency_unique" ON "identity_decisions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "item_identifiers_kind_value_idx" ON "item_identifiers" USING btree ("kind","value");--> statement-breakpoint
CREATE UNIQUE INDEX "item_identifiers_external_ref_unique" ON "item_identifiers" USING btree ("kind","source","value") WHERE kind = 'external_ref' AND invalidated_at IS NULL;--> statement-breakpoint
CREATE INDEX "item_location_periods_item_started_idx" ON "item_location_periods" USING btree ("item_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "observation_candidates_unique" ON "observation_candidates" USING btree ("observation_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "observations_scan_slot_unique" ON "observations" USING btree ("scan_id","slot_key");--> statement-breakpoint
CREATE INDEX "observations_observed_nonce_idx" ON "observations" USING btree ("observed_nonce");