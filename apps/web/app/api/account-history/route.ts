import { NextResponse } from "next/server";
import {
  ACCOUNT_HISTORY_LIMITS,
  accountHistoryRequestSchema,
  type AccountHistoryResponse,
} from "@pitantir/shared/account-history";
import { ItemSearchError } from "@pitantir/shared/item-data";
import {
  accountHistoryCacheKey,
  getAccountItemHistory,
} from "../../../src/server/account-item-history-service";
import { InMemoryRateLimiter } from "../../../src/server/rate-limit";
import { TtlCache } from "../../../src/server/search-cache";
import {
  getAccountHistoryItemProvider,
  getLocalOwnershipEnricher,
  getPitPandaOwnershipIngestor,
  getUpstreamIngestor,
} from "../../../src/server/runtime";

const rateLimiter = new InMemoryRateLimiter(
  ACCOUNT_HISTORY_LIMITS.routeLimit,
  ACCOUNT_HISTORY_LIMITS.routeWindowMs,
);
const responseCache = new TtlCache<AccountHistoryResponse>(ACCOUNT_HISTORY_LIMITS.cacheTtlMs);

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "anonymous"
  );
}

function configurationErrorResponse(): AccountHistoryResponse {
  return {
    status: "configuration_error",
    summary: null,
    items: [],
    page: 0,
    pageSize: 25,
    totalFilteredItems: 0,
    hasNextPage: false,
    graph: { nodes: [], links: [] },
    timeline: [],
    meta: {
      isComplete: false,
      itemsFetched: 0,
      pagesFetched: 0,
      hasMoreUpstreamPages: false,
      historySource: "none",
      missingHistoryCount: 0,
      warnings: [
        "PitPanda ownership history is index/search based and is not exhaustive Hypixel truth. Treat timelines as partial evidence.",
      ],
      upstreamCalls: 0,
      maxUpstreamPages: ACCOUNT_HISTORY_LIMITS.maxUpstreamPages,
      itemHistoryLookups: 0,
      maxItemHistoryLookups: ACCOUNT_HISTORY_LIMITS.maxItemHistoryLookups,
      skippedItemHistoryLookups: 0,
    },
    message: "Account history is not configured on the server.",
  };
}

function statusCodeFor(result: AccountHistoryResponse): number {
  switch (result.status) {
    case "rate_limited":
      return 429;
    case "invalid_input":
      return 400;
    case "account_not_found":
      return 404;
    case "configuration_error":
    case "upstream_unavailable":
    case "database_unavailable":
      return 503;
    default:
      return 200;
  }
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimiter.check(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        status: "rate_limited",
        summary: null,
        items: [],
        page: 0,
        pageSize: 25,
        totalFilteredItems: 0,
        hasNextPage: false,
        graph: { nodes: [], links: [] },
        timeline: [],
        meta: {
          isComplete: false,
          itemsFetched: 0,
          pagesFetched: 0,
          hasMoreUpstreamPages: false,
          historySource: "none",
          missingHistoryCount: 0,
          warnings: [
            "PitPanda ownership history is index/search based and is not exhaustive Hypixel truth. Treat timelines as partial evidence.",
          ],
          upstreamCalls: 0,
          maxUpstreamPages: ACCOUNT_HISTORY_LIMITS.maxUpstreamPages,
          itemHistoryLookups: 0,
          maxItemHistoryLookups: ACCOUNT_HISTORY_LIMITS.maxItemHistoryLookups,
          skippedItemHistoryLookups: 0,
        },
        message: "Too many account history requests. Try again shortly.",
      } satisfies AccountHistoryResponse,
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        status: "invalid_input",
        summary: null,
        items: [],
        page: 0,
        pageSize: 25,
        totalFilteredItems: 0,
        hasNextPage: false,
        graph: { nodes: [], links: [] },
        timeline: [],
        meta: {
          isComplete: false,
          itemsFetched: 0,
          pagesFetched: 0,
          hasMoreUpstreamPages: false,
          historySource: "none",
          missingHistoryCount: 0,
          warnings: [
            "PitPanda ownership history is index/search based and is not exhaustive Hypixel truth. Treat timelines as partial evidence.",
          ],
          upstreamCalls: 0,
          maxUpstreamPages: ACCOUNT_HISTORY_LIMITS.maxUpstreamPages,
          itemHistoryLookups: 0,
          maxItemHistoryLookups: ACCOUNT_HISTORY_LIMITS.maxItemHistoryLookups,
          skippedItemHistoryLookups: 0,
        },
        message: "Request body must be JSON.",
      } satisfies AccountHistoryResponse,
      { status: 400 },
    );
  }

  const parsed = accountHistoryRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        status: "invalid_input",
        summary: null,
        items: [],
        page: 0,
        pageSize: 25,
        totalFilteredItems: 0,
        hasNextPage: false,
        graph: { nodes: [], links: [] },
        timeline: [],
        meta: {
          isComplete: false,
          itemsFetched: 0,
          pagesFetched: 0,
          hasMoreUpstreamPages: false,
          historySource: "none",
          missingHistoryCount: 0,
          warnings: [
            "PitPanda ownership history is index/search based and is not exhaustive Hypixel truth. Treat timelines as partial evidence.",
          ],
          upstreamCalls: 0,
          maxUpstreamPages: ACCOUNT_HISTORY_LIMITS.maxUpstreamPages,
          itemHistoryLookups: 0,
          maxItemHistoryLookups: ACCOUNT_HISTORY_LIMITS.maxItemHistoryLookups,
          skippedItemHistoryLookups: 0,
        },
        message: "Invalid account history request.",
      } satisfies AccountHistoryResponse,
      { status: 400 },
    );
  }

  const cacheKey = accountHistoryCacheKey(parsed.data);
  const cached = responseCache.get(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    const result = await getAccountItemHistory(
      {
        provider: getAccountHistoryItemProvider(),
        ingestor: await getUpstreamIngestor(),
        enricher: await getLocalOwnershipEnricher(),
        ownershipIngestor: await getPitPandaOwnershipIngestor(),
      },
      parsed.data,
    );

    if (result.status === "ok" || result.status === "no_indexed_items") {
      responseCache.set(cacheKey, result);
    }

    return NextResponse.json(result, { status: statusCodeFor(result) });
  } catch (error) {
    if (error instanceof ItemSearchError && error.code === "configuration_error") {
      return NextResponse.json(configurationErrorResponse(), { status: 503 });
    }
    return NextResponse.json(
      {
        ...configurationErrorResponse(),
        status: "upstream_unavailable",
        message: "Account history is temporarily unavailable.",
      } satisfies AccountHistoryResponse,
      { status: 503 },
    );
  }
}
