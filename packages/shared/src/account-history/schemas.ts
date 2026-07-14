import { z } from "zod";

/** Hard limits for account inventory-history explorer (documented + enforced). */
export const ACCOUNT_HISTORY_LIMITS = {
  /** Max PitPanda current_owner pages fetched per request. */
  maxUpstreamPages: 5,
  /** Soft cap on items kept after pagination (safety). */
  maxItems: 250,
  /**
   * Max PitPanda GET /api/item/{id} history lookups per account explorer request.
   * Search list rows often omit `owners`; detail endpoint includes the timeline.
   */
  maxItemHistoryLookups: 40,
  /** Concurrent upstream item-detail fetches. */
  itemHistoryConcurrency: 4,
  /** Max Mojang UUID→username resolutions for graph labels. */
  maxUsernameResolutions: 25,
  /** App-route rate limit window. */
  routeLimit: 10,
  routeWindowMs: 60_000,
  /** In-memory response cache TTL. */
  cacheTtlMs: 60_000,
} as const;

const MINECRAFT_USERNAME = /^[A-Za-z0-9_]{3,16}$/;
const UUID_RE =
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export const accountHistoryRequestSchema = z.object({
  /** Minecraft username or UUID (dashed or undashed). */
  account: z.string().trim().min(1).max(64),
  /** 0-based page within the returned item list (client-side pagination of fetched set). */
  page: z.number().int().min(0).max(100).default(0),
  pageSize: z.number().int().min(1).max(50).default(25),
  /** Hide items that have no known prior owners in local history. */
  hideNoPriorOwners: z.boolean().default(false),
  /** Filter items to those whose type/title contains this (case-insensitive). */
  itemType: z.string().trim().max(64).optional(),
  /** Filter items to those whose enchant summary contains this. */
  enchantment: z.string().trim().max(64).optional(),
  /** Local period certainty filter for graph/history edges. */
  minCertainty: z.enum(["any", "confirmed", "uncertain"]).default("any"),
  /** ISO date lower bound for observation / period activity. */
  observedAfter: z.string().datetime().optional(),
  /** ISO date upper bound. */
  observedBefore: z.string().datetime().optional(),
  /** Focus graph / timeline on one item (canonical id or nonce). */
  selectedItemKey: z.string().trim().max(128).optional(),
});

export type AccountHistoryRequest = z.infer<typeof accountHistoryRequestSchema>;

export function classifyAccountIdentifier(value: string): "username" | "uuid" | "invalid" {
  const trimmed = value.trim();
  if (UUID_RE.test(trimmed)) return "uuid";
  if (MINECRAFT_USERNAME.test(trimmed)) return "username";
  return "invalid";
}

export const ownershipPeriodSummarySchema = z.object({
  periodId: z.string(),
  accountId: z.string().nullable(),
  accountUsername: z.string().nullable(),
  accountUuid: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  certainty: z.string(),
  isUnknownGap: z.boolean(),
  startReason: z.string().nullable(),
  endReason: z.string().nullable(),
});

export const ownershipEventSummarySchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  label: z.string(),
  eventTime: z.string(),
  certainty: z.string(),
  fromAccountId: z.string().nullable(),
  fromAccountUsername: z.string().nullable(),
  toAccountId: z.string().nullable(),
  toAccountUsername: z.string().nullable(),
});

export const accountHistoryItemSchema = z.object({
  key: z.string(),
  providerItemKey: z.string().nullable(),
  canonicalItemId: z.string().nullable(),
  title: z.string().nullable(),
  kind: z.string().nullable(),
  nonce: z.string().nullable(),
  itemUuid: z.string().nullable(),
  lives: z.number().nullable(),
  maxLives: z.number().nullable(),
  customEnchants: z.record(z.string(), z.number()).nullable(),
  lore: z.array(z.string()).nullable(),
  lastSeenAt: z.string().nullable(),
  currentOwnerUsername: z.string().nullable(),
  currentOwnerUuid: z.string().nullable(),
  source: z.string(),
  resolutionStatus: z.string().nullable(),
  hasLocalHistory: z.boolean(),
  priorOwnerCount: z.number().int().nonnegative(),
  /**
   * PitPanda owners timeline.
   * `uuid` = Minecraft player UUID (useful identity).
   * `pitpandaEventId` = PitPanda owners[] `_id` (internal event marker only).
   */
  pitpandaOwners: z.array(
    z.object({
      uuid: z.string(),
      username: z.string().nullable(),
      seenAt: z.string(),
      pitpandaEventId: z.string().nullable(),
    }),
  ),
  ownershipPeriods: z.array(ownershipPeriodSummarySchema),
  ownershipEvents: z.array(ownershipEventSummarySchema),
  historySource: z.enum(["local_database", "pitpanda", "mixed", "none"]),
  /** PitPanda Mongo item doc id — fetch key only, not a Minecraft UUID. */
  pitpandaItemId: z.string().nullable(),
  rawPayload: z.record(z.string(), z.unknown()).optional(),
});

export type AccountHistoryItem = z.infer<typeof accountHistoryItemSchema>;

export const accountHistoryMetaSchema = z.object({
  isComplete: z.boolean(),
  itemsFetched: z.number().int().nonnegative(),
  pagesFetched: z.number().int().nonnegative(),
  hasMoreUpstreamPages: z.boolean(),
  historySource: z.enum(["local_database", "pitpanda", "mixed", "none"]),
  missingHistoryCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  upstreamCalls: z.number().int().nonnegative(),
  maxUpstreamPages: z.number().int().positive(),
  itemHistoryLookups: z.number().int().nonnegative(),
  maxItemHistoryLookups: z.number().int().positive(),
  skippedItemHistoryLookups: z.number().int().nonnegative(),
});

export const accountHistorySummarySchema = z.object({
  username: z.string().nullable(),
  uuid: z.string().nullable(),
  totalIndexedItems: z.number().int().nonnegative(),
  distinctPreviousOwners: z.number().int().nonnegative(),
  earliestObservationAt: z.string().nullable(),
  latestObservationAt: z.string().nullable(),
});

export const accountHistoryGraphNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(["account", "item"]),
  label: z.string(),
  emphasized: z.boolean().optional(),
  username: z.string().nullable().optional(),
  uuid: z.string().nullable().optional(),
  nonce: z.string().nullable().optional(),
  itemType: z.string().nullable().optional(),
  firstSeenAt: z.string().nullable().optional(),
  lastSeenAt: z.string().nullable().optional(),
  certainty: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
});

export const accountHistoryGraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
  firstSeenAt: z.string().nullable().optional(),
  lastSeenAt: z.string().nullable().optional(),
  certainty: z.string().nullable().optional(),
  observationSource: z.string().nullable().optional(),
});

export const accountHistoryResponseSchema = z.object({
  status: z.enum([
    "ok",
    "invalid_input",
    "account_not_found",
    "no_indexed_items",
    "configuration_error",
    "rate_limited",
    "upstream_unavailable",
    "database_unavailable",
  ]),
  summary: accountHistorySummarySchema.nullable(),
  items: z.array(accountHistoryItemSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalFilteredItems: z.number().int().nonnegative(),
  hasNextPage: z.boolean(),
  graph: z.object({
    nodes: z.array(accountHistoryGraphNodeSchema),
    links: z.array(accountHistoryGraphEdgeSchema),
  }),
  timeline: z.array(ownershipEventSummarySchema).optional(),
  meta: accountHistoryMetaSchema,
  message: z.string().optional(),
});

export type AccountHistoryResponse = z.infer<typeof accountHistoryResponseSchema>;
export type AccountHistoryGraphNode = z.infer<typeof accountHistoryGraphNodeSchema>;
export type AccountHistoryGraphEdge = z.infer<typeof accountHistoryGraphEdgeSchema>;
