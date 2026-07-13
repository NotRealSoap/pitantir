import { NextResponse } from "next/server";
import { itemSearchRequestSchema } from "@pitantir/shared/item-data";
import { executeItemSearch, itemSearchCacheKey } from "../../../src/server/item-search-service";
import { InMemoryRateLimiter } from "../../../src/server/rate-limit";
import { TtlCache } from "../../../src/server/search-cache";
import { getItemDataProvider, getUpstreamIngestor } from "../../../src/server/runtime";
import type { ItemSearchResponse } from "@pitantir/shared/item-data";

const rateLimiter = new InMemoryRateLimiter(20, 60_000);
const searchCache = new TtlCache<ItemSearchResponse>(60_000);

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "anonymous"
  );
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimiter.check(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        status: "rate_limited",
        page: 0,
        hasNextPage: false,
        items: [],
        message: "Too many searches. Try again shortly.",
      } satisfies ItemSearchResponse,
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
        status: "invalid_search",
        page: 0,
        hasNextPage: false,
        items: [],
        message: "Request body must be JSON.",
      } satisfies ItemSearchResponse,
      { status: 400 },
    );
  }

  const parsed = itemSearchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        status: "invalid_search",
        page: 0,
        hasNextPage: false,
        items: [],
        message: "Invalid search request.",
      } satisfies ItemSearchResponse,
      { status: 400 },
    );
  }

  const cacheKey = itemSearchCacheKey(parsed.data);
  const cached = searchCache.get(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    const result = await executeItemSearch(
      {
        provider: getItemDataProvider(),
        ingestor: getUpstreamIngestor(),
      },
      parsed.data,
    );
    if (result.status === "ok" || result.status === "no_results") {
      searchCache.set(cacheKey, result);
    }
    const statusCode =
      result.status === "rate_limited"
        ? 429
        : result.status === "invalid_search"
          ? 400
          : result.status === "upstream_unavailable"
            ? 503
            : 200;
    return NextResponse.json(result, { status: statusCode });
  } catch {
    return NextResponse.json(
      {
        status: "upstream_unavailable",
        page: parsed.data.page,
        hasNextPage: false,
        items: [],
        message: "Item search is temporarily unavailable.",
      } satisfies ItemSearchResponse,
      { status: 503 },
    );
  }
}
