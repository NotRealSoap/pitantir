import { sql } from "drizzle-orm";
import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  numeric,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const itemCategoryEnum = pgEnum("item_category", [
  "unique_nonce_candidate",
  "duplicate_nonce",
  "nonce_less",
  "unknown",
]);

export const identityConfidenceEnum = pgEnum("identity_confidence", [
  "high",
  "medium",
  "low",
  "contested",
]);

export const identifierConfidenceEnum = pgEnum("identifier_confidence", [
  "high",
  "medium",
  "low",
]);

export const itemStatusEnum = pgEnum("item_status", [
  "active",
  "merged_away",
  "split_source",
  "archived",
]);

export const identifierKindEnum = pgEnum("identifier_kind", [
  "nonce",
  "strict_fingerprint",
  "loose_fingerprint",
  "external_ref",
  "manual_tag",
  "legacy_id",
]);

export const resolutionStatusEnum = pgEnum("resolution_status", [
  "resolved",
  "probable",
  "ambiguous",
  "unresolved",
  "manually_resolved",
]);

export const decisionTypeEnum = pgEnum("decision_type", [
  "auto_resolve",
  "manual_resolve",
  "unlink",
  "create_item",
  "merge",
  "split",
  "invalidate_identifier",
  "link_import",
  "reject_import",
  "correct_location",
  "revert",
]);

export const canonicalItems = pgTable(
  "canonical_items",
  {
    id: uuid("id").primaryKey(),
    displayName: text("display_name"),
    category: itemCategoryEnum("category").notNull(),
    identityConfidence: identityConfidenceEnum("identity_confidence").notNull(),
    primaryNonce: text("primary_nonce"),
    strictFingerprint: text("strict_fingerprint"),
    looseFingerprint: text("loose_fingerprint"),
    status: itemStatusEnum("status").notNull(),
    mergedIntoItemId: uuid("merged_into_item_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    primaryNonceIdx: index("canonical_items_primary_nonce_idx").on(table.primaryNonce),
    strictFingerprintIdx: index("canonical_items_strict_fingerprint_idx").on(
      table.strictFingerprint,
    ),
  }),
);

export const itemIdentifiers = pgTable(
  "item_identifiers",
  {
    id: uuid("id").primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => canonicalItems.id),
    kind: identifierKindEnum("kind").notNull(),
    source: text("source"),
    value: text("value").notNull(),
    isPreferred: boolean("is_preferred").notNull().default(false),
    confidence: identifierConfidenceEnum("identifier_confidence").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  },
  (table) => ({
    kindValueIdx: index("item_identifiers_kind_value_idx").on(table.kind, table.value),
    externalRefUnique: uniqueIndex("item_identifiers_external_ref_unique")
      .on(table.kind, table.source, table.value)
      .where(sql`kind = 'external_ref' AND invalidated_at IS NULL`),
  }),
);

export const observations = pgTable(
  "observations",
  {
    id: uuid("id").primaryKey(),
    scanId: uuid("scan_id").notNull(),
    accountId: uuid("account_id").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    slotKey: text("slot_key").notNull(),
    rawItem: jsonb("raw_item").notNull(),
    observedNonce: text("observed_nonce"),
    normalizedMetadata: jsonb("normalized_metadata").notNull(),
    strictFingerprint: text("strict_fingerprint").notNull(),
    looseFingerprint: text("loose_fingerprint").notNull(),
    canonicalItemId: uuid("canonical_item_id").references(() => canonicalItems.id),
    resolutionStatus: resolutionStatusEnum("resolution_status").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    resolutionNote: text("resolution_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    scanSlotUnique: uniqueIndex("observations_scan_slot_unique").on(
      table.scanId,
      table.slotKey,
    ),
    observedNonceIdx: index("observations_observed_nonce_idx").on(table.observedNonce),
  }),
);

export const observationCandidates = pgTable(
  "observation_candidates",
  {
    id: uuid("id").primaryKey(),
    observationId: uuid("observation_id")
      .notNull()
      .references(() => observations.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => canonicalItems.id),
    score: numeric("score", { precision: 5, scale: 4 }).notNull(),
    reasons: jsonb("reasons").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    observationItemUnique: uniqueIndex("observation_candidates_unique").on(
      table.observationId,
      table.itemId,
    ),
  }),
);

export const identityDecisions = pgTable(
  "identity_decisions",
  {
    id: uuid("id").primaryKey(),
    decisionType: decisionTypeEnum("decision_type").notNull(),
    actor: text("actor").notNull(),
    observationId: uuid("observation_id"),
    importClaimId: uuid("import_claim_id"),
    fromItemIds: uuid("from_item_ids").array().notNull().default([]),
    toItemIds: uuid("to_item_ids").array().notNull().default([]),
    beforeState: jsonb("before_state").notNull(),
    afterState: jsonb("after_state").notNull(),
    rationale: text("rationale"),
    idempotencyKey: text("idempotency_key"),
    revertsDecisionId: uuid("reverts_decision_id"),
    reversedByDecisionId: uuid("reversed_by_decision_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    idempotencyUnique: uniqueIndex("identity_decisions_idempotency_unique").on(
      table.idempotencyKey,
    ),
  }),
);

export const itemLocationPeriods = pgTable(
  "item_location_periods",
  {
    id: uuid("id").primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => canonicalItems.id),
    accountId: uuid("account_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    startReason: text("start_reason").notNull(),
    endReason: text("end_reason"),
    certainty: text("certainty").notNull(),
    isUnknownGap: boolean("is_unknown_gap").notNull().default(false),
    openingObservationId: uuid("opening_observation_id"),
    closingObservationContextScanId: uuid("closing_observation_context_scan_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    supersededByPeriodId: uuid("superseded_by_period_id"),
  },
  (table) => ({
    itemStartedIdx: index("item_location_periods_item_started_idx").on(
      table.itemId,
      table.startedAt,
    ),
  }),
);
