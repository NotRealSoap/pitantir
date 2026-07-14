export const ITEM_CATEGORIES = [
  "unique_nonce_candidate",
  "duplicate_nonce",
  "nonce_less",
  "unknown",
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const IDENTITY_CONFIDENCES = ["high", "medium", "low", "contested"] as const;
export type IdentityConfidence = (typeof IDENTITY_CONFIDENCES)[number];

export const ITEM_STATUSES = ["active", "merged_away", "split_source", "archived"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const IDENTIFIER_KINDS = [
  "nonce",
  "strict_fingerprint",
  "loose_fingerprint",
  "external_ref",
  "manual_tag",
  "legacy_id",
] as const;
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

export const IDENTIFIER_CONFIDENCES = ["high", "medium", "low"] as const;
export type IdentifierConfidence = (typeof IDENTIFIER_CONFIDENCES)[number];

export const RESOLUTION_STATUSES = [
  "resolved",
  "probable",
  "ambiguous",
  "unresolved",
  "manually_resolved",
] as const;
export type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number];

export const RESOLVED_BY_VALUES = ["auto", "manual", "import_link"] as const;
export type ResolvedBy = (typeof RESOLVED_BY_VALUES)[number];

export const DECISION_TYPES = [
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
] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

export const PERIOD_CERTAINTIES = ["confirmed", "probable", "uncertain", "contradicted"] as const;
export type PeriodCertainty = (typeof PERIOD_CERTAINTIES)[number];

export const PERIOD_START_REASONS = [
  "observed",
  "import",
  "manual",
  "inferred_move",
  "split",
  "merge",
] as const;
export type PeriodStartReason = (typeof PERIOD_START_REASONS)[number];

export const PERIOD_END_REASONS = [
  "disappeared",
  "moved_confirmed",
  "unknown_gap",
  "manual",
  "merged_away",
  "corrected",
] as const;
export type PeriodEndReason = (typeof PERIOD_END_REASONS)[number];

export const LOCATION_EVENT_TYPES = [
  "seen",
  "disappeared",
  "unknown_started",
  "move_confirmed",
  "move_uncertain",
  "contradiction",
  "import_presence",
  "manual_correction",
] as const;
export type LocationEventType = (typeof LOCATION_EVENT_TYPES)[number];
