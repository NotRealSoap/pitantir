import { createHash } from "node:crypto";
import {
  ACCOUNT_HISTORY_LIMITS,
  accountHistoryRequestSchema,
  buildItemTimeline,
  buildOwnershipGraph,
  classifyAccountIdentifier,
  hasEmbeddedOwners,
  parseUpstreamItemFields,
  type AccountHistoryItem,
  type AccountHistoryRequest,
  type AccountHistoryResponse,
} from "@pitantir/shared/account-history";
import {
  ItemSearchError,
  type ItemSearchInput,
  type ItemSearchPage,
  type NormalizedUpstreamItem,
} from "@pitantir/shared/item-data";
import {
  MojangLookupError,
  resolveMinecraftProfileByUsername,
  resolveMinecraftProfileByUuid,
  type MinecraftProfile,
} from "@pitantir/shared/inventory";
import type { LocalOwnershipBundle, LocalOwnershipEnricher } from "@pitantir/db";
import type { UpstreamObservationIngestor } from "@pitantir/db";

const HISTORY_WARNING =
  "PitPanda ownership history is index/search based and is not exhaustive Hypixel truth. Treat timelines as partial evidence.";

export interface AccountHistoryProvider {
  searchItems(input: ItemSearchInput): Promise<ItemSearchPage>;
  getItemDetail(itemId: string): Promise<NormalizedUpstreamItem>;
}

export interface AccountItemHistoryDeps {
  provider: AccountHistoryProvider;
  ingestor?: UpstreamObservationIngestor | null;
  enricher: LocalOwnershipEnricher | null;
  resolveProfileByUsername?: (
    username: string,
    fetchImpl?: typeof fetch,
  ) => Promise<MinecraftProfile>;
  resolveProfileByUuid?: (
    uuid: string,
    fetchImpl?: typeof fetch,
  ) => Promise<MinecraftProfile>;
  fetchImpl?: typeof fetch;
}

type EmptyMeta = AccountHistoryResponse["meta"];

function emptyMeta(partial?: Partial<EmptyMeta>): EmptyMeta {
  return {
    isComplete: false,
    itemsFetched: 0,
    pagesFetched: 0,
    hasMoreUpstreamPages: false,
    historySource: "none",
    missingHistoryCount: 0,
    warnings: [HISTORY_WARNING],
    upstreamCalls: 0,
    maxUpstreamPages: ACCOUNT_HISTORY_LIMITS.maxUpstreamPages,
    itemHistoryLookups: 0,
    maxItemHistoryLookups: ACCOUNT_HISTORY_LIMITS.maxItemHistoryLookups,
    skippedItemHistoryLookups: 0,
    ...partial,
  };
}

function emptyResponse(
  status: AccountHistoryResponse["status"],
  message: string,
  page = 0,
  pageSize = 25,
  meta?: Partial<EmptyMeta>,
): AccountHistoryResponse {
  return {
    status,
    summary: null,
    items: [],
    page,
    pageSize,
    totalFilteredItems: 0,
    hasNextPage: false,
    graph: { nodes: [], links: [] },
    timeline: [],
    meta: emptyMeta(meta),
    message,
  };
}

function normalizeUuidKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const hex = value.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return value.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function undash(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

function stripSecrets(payload: Record<string, unknown>): Record<string, unknown> {
  const banned = /api[_-]?key|authorization|x-api-key|secret|password|token/i;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (banned.test(key)) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = stripSecrets(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
}

function enchantSummary(enchants: Record<string, number> | null): string {
  if (!enchants) return "";
  return Object.entries(enchants)
    .map(([key, level]) => `${key} ${level}`)
    .join(" ")
    .toLowerCase();
}

function itemMatchesFilters(
  item: AccountHistoryItem,
  request: AccountHistoryRequest,
): boolean {
  if (request.hideNoPriorOwners && item.priorOwnerCount === 0) return false;

  if (request.itemType) {
    const needle = request.itemType.toLowerCase();
    const hay = `${item.kind ?? ""} ${item.title ?? ""}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }

  if (request.enchantment) {
    const needle = request.enchantment.toLowerCase();
    if (!enchantSummary(item.customEnchants).includes(needle)) return false;
  }

  const activityTimes = [
    item.lastSeenAt,
    ...item.pitpandaOwners.map((o) => o.seenAt),
    ...item.ownershipPeriods.map((p) => p.startedAt),
    ...item.ownershipPeriods.map((p) => p.endedAt),
    ...item.ownershipEvents.map((e) => e.eventTime),
  ].filter((value): value is string => Boolean(value));

  if (request.observedAfter) {
    const after = request.observedAfter;
    if (activityTimes.length === 0 || !activityTimes.some((t) => t >= after)) return false;
  }
  if (request.observedBefore) {
    const before = request.observedBefore;
    if (activityTimes.length === 0 || !activityTimes.some((t) => t <= before)) return false;
  }

  return true;
}

function deriveHistorySource(
  pitpandaOwners: number,
  localPeriods: number,
  localEvents: number,
): AccountHistoryItem["historySource"] {
  const hasPit = pitpandaOwners > 0;
  const hasLocal = localPeriods > 0 || localEvents > 0;
  if (hasPit && hasLocal) return "mixed";
  if (hasPit) return "pitpanda";
  if (hasLocal) return "local_database";
  return "none";
}

function aggregateHistorySource(
  items: AccountHistoryItem[],
): AccountHistoryItem["historySource"] {
  const set = new Set(items.map((item) => item.historySource));
  if (set.has("mixed") || (set.has("pitpanda") && set.has("local_database"))) return "mixed";
  if (set.has("pitpanda")) return "pitpanda";
  if (set.has("local_database")) return "local_database";
  return "none";
}

export function accountHistoryCacheKey(request: AccountHistoryRequest): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

export async function getAccountItemHistory(
  deps: AccountItemHistoryDeps,
  rawRequest: AccountHistoryRequest,
): Promise<AccountHistoryResponse> {
  const request = accountHistoryRequestSchema.parse(rawRequest);
  const resolveByUsername = deps.resolveProfileByUsername ?? resolveMinecraftProfileByUsername;
  const resolveByUuid = deps.resolveProfileByUuid ?? resolveMinecraftProfileByUuid;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const kind = classifyAccountIdentifier(request.account);
  if (kind === "invalid") {
    return emptyResponse(
      "invalid_input",
      "Enter a Minecraft username (3–16 chars) or UUID.",
      request.page,
      request.pageSize,
    );
  }

  let profile: MinecraftProfile;
  try {
    profile =
      kind === "username"
        ? await resolveByUsername(request.account.trim(), fetchImpl)
        : await resolveByUuid(request.account.trim(), fetchImpl);
  } catch (error) {
    if (error instanceof MojangLookupError && error.code === "not_found") {
      return emptyResponse(
        "account_not_found",
        "No Minecraft profile matched that username or UUID.",
        request.page,
        request.pageSize,
      );
    }
    if (error instanceof MojangLookupError && error.code === "invalid_response") {
      return emptyResponse(
        "invalid_input",
        error.message,
        request.page,
        request.pageSize,
      );
    }
    return emptyResponse(
      "upstream_unavailable",
      "Unable to resolve Minecraft profile right now.",
      request.page,
      request.pageSize,
    );
  }

  const searchedUuid = normalizeUuidKey(profile.uuid)!;
  const searchedUsername = profile.username;
  let upstreamCalls = 0;
  let pagesFetched = 0;
  let hasMoreUpstreamPages = false;
  const collected: NormalizedUpstreamItem[] = [];
  const seenKeys = new Set<string>();

  try {
    for (let page = 0; page < ACCOUNT_HISTORY_LIMITS.maxUpstreamPages; page += 1) {
      const pageResult = await deps.provider.searchItems({
        kind: "current_owner",
        value: searchedUsername,
        page,
      });
      upstreamCalls += 1;
      pagesFetched += 1;

      if (pageResult.items.length === 0) {
        hasMoreUpstreamPages = false;
        break;
      }

      for (const item of pageResult.items) {
        const dedupeKey =
          typeof item.rawPayload._id === "string" && item.rawPayload._id.trim()
            ? `id:${item.rawPayload._id.trim()}`
            : `key:${item.providerItemKey}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);
        collected.push(item);
        if (collected.length >= ACCOUNT_HISTORY_LIMITS.maxItems) break;
      }

      hasMoreUpstreamPages = pageResult.hasNextPage === true;
      if (collected.length >= ACCOUNT_HISTORY_LIMITS.maxItems) {
        hasMoreUpstreamPages = true;
        break;
      }
      if (!pageResult.hasNextPage) {
        hasMoreUpstreamPages = false;
        break;
      }
    }
  } catch (error) {
    return mapUpstreamError(error, request.page, request.pageSize, {
      upstreamCalls,
      pagesFetched,
    });
  }

  if (collected.length === 0) {
    return {
      status: "no_indexed_items",
      summary: {
        username: searchedUsername,
        uuid: searchedUuid,
        totalIndexedItems: 0,
        distinctPreviousOwners: 0,
        earliestObservationAt: null,
        latestObservationAt: null,
      },
      items: [],
      page: request.page,
      pageSize: request.pageSize,
      totalFilteredItems: 0,
      hasNextPage: false,
      graph: { nodes: [], links: [] },
      timeline: [],
      meta: emptyMeta({
        upstreamCalls,
        pagesFetched,
        hasMoreUpstreamPages: false,
        isComplete: true,
      }),
      message: "PitPanda returned no indexed items for this account as current owner.",
    };
  }

  let ingestedByKey = new Map<string, { canonicalItemId: string | null; resolutionStatus: string }>();
  if (deps.ingestor) {
    try {
      const ingestion = await deps.ingestor.ingest(collected, {
        searchQuery: `current_owner:${searchedUsername}`,
      });
      ingestedByKey = new Map(
        ingestion.ingested.map((row) => [
          row.providerItemKey,
          {
            canonicalItemId: row.canonicalItemId,
            resolutionStatus: row.resolutionStatus,
          },
        ]),
      );
    } catch {
      // Ingestion is best-effort; continue with enricher matching.
    }
  }

  // Detail lookups for items missing embedded owners
  const needDetail: Array<{ index: number; itemId: string }> = [];
  for (let index = 0; index < collected.length; index += 1) {
    const item = collected[index]!;
    if (hasEmbeddedOwners(item.rawPayload)) continue;
    const id =
      typeof item.rawPayload._id === "string" && /^[a-f0-9]{24}$/i.test(item.rawPayload._id.trim())
        ? item.rawPayload._id.trim()
        : null;
    if (!id) continue;
    needDetail.push({ index, itemId: id });
  }

  const lookupBudget = Math.min(needDetail.length, ACCOUNT_HISTORY_LIMITS.maxItemHistoryLookups);
  const toLookup = needDetail.slice(0, lookupBudget);
  const skippedItemHistoryLookups = needDetail.length - toLookup.length;
  let itemHistoryLookups = 0;
  const inFlight = new Map<string, Promise<NormalizedUpstreamItem | null>>();

  const getDetailCached = (itemId: string): Promise<NormalizedUpstreamItem | null> => {
    const existing = inFlight.get(itemId);
    if (existing) return existing;
    const promise = (async () => {
      try {
        itemHistoryLookups += 1;
        upstreamCalls += 1;
        return await deps.provider.getItemDetail(itemId);
      } catch {
        return null;
      }
    })();
    inFlight.set(itemId, promise);
    return promise;
  };

  await mapPool(toLookup, ACCOUNT_HISTORY_LIMITS.itemHistoryConcurrency, async (entry) => {
    const detail = await getDetailCached(entry.itemId);
    if (!detail) return;
    const current = collected[entry.index]!;
    collected[entry.index] = {
      ...current,
      rawPayload: { ...current.rawPayload, ...detail.rawPayload },
      observedAt: detail.observedAt ?? current.observedAt,
    };
  });

  // Local enrichment by nonce / canonical id
  const parsedFields = collected.map((item) => parseUpstreamItemFields(item.rawPayload));
  const nonces = parsedFields.map((f) => f.nonce).filter((n): n is string => Boolean(n));
  const bundlesByItemId = new Map<string, LocalOwnershipBundle>();
  const canonicalIdsByNonce = new Map<string, string[]>();

  if (deps.enricher) {
    try {
      const nonceMap = await deps.enricher.findCanonicalIdsByNonces(nonces);
      for (const [nonce, ids] of nonceMap) canonicalIdsByNonce.set(nonce, ids);

      const allIds = new Set<string>();
      for (const ids of nonceMap.values()) {
        for (const id of ids) allIds.add(id);
      }
      for (const [key, ingested] of ingestedByKey) {
        if (ingested.canonicalItemId) allIds.add(ingested.canonicalItemId);
        void key;
      }

      const bundles = await deps.enricher.loadOwnershipBundles([...allIds]);
      for (const [id, bundle] of bundles) bundlesByItemId.set(id, bundle);
    } catch {
      // Local DB enrichment is preferred but optional.
    }
  }

  // Username resolution for owners
  const usernameByUuid = new Map<string, string>();
  usernameByUuid.set(searchedUuid, searchedUsername);

  const ownerUuids = new Set<string>();
  for (const fields of parsedFields) {
    for (const owner of fields.owners) {
      const normalized = normalizeUuidKey(owner.uuid);
      if (normalized) ownerUuids.add(normalized);
    }
    if (fields.ownerUuid) {
      const normalized = normalizeUuidKey(fields.ownerUuid);
      if (normalized) ownerUuids.add(normalized);
    }
  }
  for (const bundle of bundlesByItemId.values()) {
    for (const period of bundle.periods) {
      const normalized = normalizeUuidKey(period.accountUuid);
      if (normalized) ownerUuids.add(normalized);
    }
  }

  const unresolved = [...ownerUuids].filter((uuid) => !usernameByUuid.has(uuid));
  if (deps.enricher && unresolved.length > 0) {
    try {
      const localNames = await deps.enricher.findUsernamesByUuids(unresolved);
      for (const [uuid, username] of localNames) {
        usernameByUuid.set(normalizeUuidKey(uuid)!, username);
      }
    } catch {
      // ignore
    }
  }

  const stillUnresolved = unresolved.filter((uuid) => !usernameByUuid.has(uuid));
  const mojangBudget = Math.min(stillUnresolved.length, ACCOUNT_HISTORY_LIMITS.maxUsernameResolutions);
  for (let i = 0; i < mojangBudget; i += 1) {
    const uuid = stillUnresolved[i]!;
    try {
      const resolved = await resolveByUuid(uuid, fetchImpl);
      usernameByUuid.set(normalizeUuidKey(resolved.uuid)!, resolved.username);
    } catch {
      // leave username null
    }
  }

  const historyItems: AccountHistoryItem[] = collected.map((item, index) => {
    const fields = parsedFields[index]!;
    const ingested = ingestedByKey.get(item.providerItemKey);
    let canonicalItemId = ingested?.canonicalItemId ?? null;
    if (!canonicalItemId && fields.nonce) {
      canonicalItemId = canonicalIdsByNonce.get(fields.nonce)?.[0] ?? null;
    }

    const bundle = canonicalItemId ? bundlesByItemId.get(canonicalItemId) : undefined;
    const pitpandaOwners = fields.owners.map((owner) => {
      const uuid = normalizeUuidKey(owner.uuid)!;
      return {
        uuid,
        username: usernameByUuid.get(uuid) ?? null,
        seenAt: owner.seenAt,
        recordId: owner.recordId,
      };
    });

    const ownershipPeriods =
      bundle?.periods.map((period) => ({
        periodId: period.periodId,
        accountId: period.accountId,
        accountUsername:
          period.accountUsername ??
          (period.accountUuid ? usernameByUuid.get(normalizeUuidKey(period.accountUuid)!) ?? null : null),
        accountUuid: normalizeUuidKey(period.accountUuid),
        startedAt: period.startedAt.toISOString(),
        endedAt: period.endedAt ? period.endedAt.toISOString() : null,
        certainty: period.certainty,
        isUnknownGap: period.isUnknownGap,
        startReason: period.startReason,
        endReason: period.endReason,
      })) ?? [];

    const ownershipEvents =
      bundle?.events.map((event) => ({
        eventId: event.eventId,
        eventType: event.eventType,
        label: event.label,
        eventTime: event.eventTime.toISOString(),
        certainty: event.certainty,
        fromAccountId: event.fromAccountId,
        fromAccountUsername: event.fromAccountUsername,
        toAccountId: event.toAccountId,
        toAccountUsername: event.toAccountUsername,
      })) ?? [];

    const priorOwnerUuids = new Set<string>();
    for (const owner of pitpandaOwners) {
      if (undash(owner.uuid) !== undash(searchedUuid)) priorOwnerUuids.add(undash(owner.uuid));
    }
    for (const period of ownershipPeriods) {
      if (period.isUnknownGap || !period.accountUuid) continue;
      if (undash(period.accountUuid) !== undash(searchedUuid)) {
        priorOwnerUuids.add(undash(period.accountUuid));
      }
    }

    const historySource = deriveHistorySource(
      pitpandaOwners.length,
      ownershipPeriods.length,
      ownershipEvents.length,
    );

    const key =
      fields.pitpandaItemId ??
      item.providerItemKey ??
      fields.nonce ??
      `idx:${index}`;

    return {
      key,
      providerItemKey: item.providerItemKey,
      canonicalItemId,
      title: fields.title ?? bundle?.displayName ?? null,
      kind: fields.kind,
      nonce: fields.nonce,
      itemUuid: fields.itemUuid,
      lives: fields.lives,
      maxLives: fields.maxLives,
      customEnchants: fields.customEnchants,
      lore: fields.lore,
      lastSeenAt: fields.lastSeenAt ?? item.observedAt?.toISOString() ?? null,
      currentOwnerUsername: searchedUsername,
      currentOwnerUuid: searchedUuid,
      source: item.source,
      resolutionStatus: ingested?.resolutionStatus ?? null,
      hasLocalHistory: Boolean(bundle && (bundle.periods.length > 0 || bundle.events.length > 0)),
      priorOwnerCount: priorOwnerUuids.size,
      pitpandaOwners,
      ownershipPeriods,
      ownershipEvents,
      historySource,
      pitpandaItemId: fields.pitpandaItemId,
      rawPayload: stripSecrets(item.rawPayload),
    };
  });

  // Re-parse after detail merge already done above into parsedFields — refresh owners counts for missing
  const missingHistoryCount = historyItems.filter(
    (item) => item.historySource === "none",
  ).length;

  const filtered = historyItems.filter((item) => itemMatchesFilters(item, request));
  const start = request.page * request.pageSize;
  const pageItems = filtered.slice(start, start + request.pageSize);
  const hasNextPage = start + request.pageSize < filtered.length;

  const graph = buildOwnershipGraph({
    searchedUsername,
    searchedUuid,
    items: filtered,
    selectedItemKey: request.selectedItemKey,
    minCertainty: request.minCertainty,
  });
  const timeline = buildItemTimeline(filtered, request.selectedItemKey);

  const priorAcross = new Set<string>();
  let earliest: string | null = null;
  let latest: string | null = null;
  const considerTime = (value: string | null | undefined) => {
    if (!value) return;
    if (!earliest || value < earliest) earliest = value;
    if (!latest || value > latest) latest = value;
  };
  for (const item of historyItems) {
    for (const owner of item.pitpandaOwners) {
      if (undash(owner.uuid) !== undash(searchedUuid)) priorAcross.add(undash(owner.uuid));
      considerTime(owner.seenAt);
    }
    for (const period of item.ownershipPeriods) {
      if (period.accountUuid && undash(period.accountUuid) !== undash(searchedUuid)) {
        priorAcross.add(undash(period.accountUuid));
      }
      considerTime(period.startedAt);
      considerTime(period.endedAt);
    }
    considerTime(item.lastSeenAt);
  }

  const historySource = aggregateHistorySource(historyItems);
  const isComplete =
    !hasMoreUpstreamPages &&
    skippedItemHistoryLookups === 0 &&
    missingHistoryCount === 0;

  const warnings = [HISTORY_WARNING];
  if (hasMoreUpstreamPages) {
    warnings.push(
      `Stopped after ${ACCOUNT_HISTORY_LIMITS.maxUpstreamPages} upstream pages or ${ACCOUNT_HISTORY_LIMITS.maxItems} items; more may exist.`,
    );
  }
  if (skippedItemHistoryLookups > 0) {
    warnings.push(
      `Skipped ${skippedItemHistoryLookups} item history detail lookup(s) due to the per-request cap.`,
    );
  }
  if (missingHistoryCount > 0) {
    warnings.push(`${missingHistoryCount} item(s) have no PitPanda or local ownership history.`);
  }
  if (!isComplete) {
    warnings.push("Result set is incomplete; do not treat as full ownership history.");
  }

  return {
    status: "ok",
    summary: {
      username: searchedUsername,
      uuid: searchedUuid,
      totalIndexedItems: historyItems.length,
      distinctPreviousOwners: priorAcross.size,
      earliestObservationAt: earliest,
      latestObservationAt: latest,
    },
    items: pageItems,
    page: request.page,
    pageSize: request.pageSize,
    totalFilteredItems: filtered.length,
    hasNextPage,
    graph,
    timeline,
    meta: {
      isComplete,
      itemsFetched: historyItems.length,
      pagesFetched,
      hasMoreUpstreamPages,
      historySource,
      missingHistoryCount,
      warnings,
      upstreamCalls,
      maxUpstreamPages: ACCOUNT_HISTORY_LIMITS.maxUpstreamPages,
      itemHistoryLookups,
      maxItemHistoryLookups: ACCOUNT_HISTORY_LIMITS.maxItemHistoryLookups,
      skippedItemHistoryLookups,
    },
  };
}

function mapUpstreamError(
  error: unknown,
  page: number,
  pageSize: number,
  meta: Partial<EmptyMeta>,
): AccountHistoryResponse {
  if (error instanceof ItemSearchError) {
    switch (error.code) {
      case "configuration_error":
        return emptyResponse(
          "configuration_error",
          "Account history is not configured on the server.",
          page,
          pageSize,
          meta,
        );
      case "upstream_rate_limited":
        return emptyResponse(
          "rate_limited",
          "Upstream rate limit reached. Try again shortly.",
          page,
          pageSize,
          meta,
        );
      case "upstream_unauthorized":
        return emptyResponse(
          "configuration_error",
          "Upstream provider rejected credentials.",
          page,
          pageSize,
          meta,
        );
      case "invalid_search":
        return emptyResponse("invalid_input", error.message, page, pageSize, meta);
      default:
        return emptyResponse(
          "upstream_unavailable",
          "PitPanda is temporarily unavailable.",
          page,
          pageSize,
          meta,
        );
    }
  }
  return emptyResponse(
    "upstream_unavailable",
    "Account history is temporarily unavailable.",
    page,
    pageSize,
    meta,
  );
}
