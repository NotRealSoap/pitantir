import { createHash } from "node:crypto";
import {
  ItemSearchError,
  type ItemDataProvider,
  type ItemSearchRequest,
  validateSearchValue,
  domainSearchQueryLabel,
} from "@pitantir/shared/item-data";
import type { ItemSearchResponse } from "@pitantir/shared/item-data";
import type { UpstreamObservationIngestor } from "@pitantir/db";

export interface ItemSearchExecutionDeps {
  provider: ItemDataProvider;
  ingestor: UpstreamObservationIngestor;
}

export async function executeItemSearch(
  deps: ItemSearchExecutionDeps,
  request: ItemSearchRequest,
): Promise<ItemSearchResponse> {
  try {
    const value = validateSearchValue(request.kind, request.value);
    const input = { kind: request.kind, value, page: request.page };

    if (!deps.provider.supports(input.kind)) {
      return {
        status: "unsupported_search",
        page: request.page,
        hasNextPage: false,
        items: [],
        message: "This search type is not supported by the configured provider.",
      };
    }

    const page = await deps.provider.searchItems(input);
    if (page.items.length === 0) {
      return {
        status: "no_results",
        dataSource: "pitpanda",
        page: page.page,
        hasNextPage: false,
        items: [],
        message: "No items matched this search.",
      };
    }

    const ingestion = await deps.ingestor.ingest(page.items, {
      searchQuery: domainSearchQueryLabel(input),
    });

    return {
      status: "ok",
      dataSource: "pitpanda",
      page: page.page,
      hasNextPage: page.hasNextPage,
      items: page.items.map((item, index) => ({
        providerItemKey: item.providerItemKey,
        source: item.source,
        observedAt: item.observedAt?.toISOString() ?? null,
        resolutionStatus: ingestion.ingested[index]?.resolutionStatus ?? "unresolved",
        canonicalItemId: ingestion.ingested[index]?.canonicalItemId ?? null,
        rawPayload: item.rawPayload,
      })),
    };
  } catch (error) {
    if (error instanceof ItemSearchError) {
      return mapItemSearchError(error, request.page);
    }
    if (error instanceof Error && error.message.startsWith("Invalid ")) {
      return {
        status: "invalid_search",
        page: request.page,
        hasNextPage: false,
        items: [],
        message: error.message,
      };
    }
    return {
      status: "upstream_unavailable",
      page: request.page,
      hasNextPage: false,
      items: [],
      message: "Item search is temporarily unavailable.",
    };
  }
}

function mapItemSearchError(error: ItemSearchError, page: number): ItemSearchResponse {
  switch (error.code) {
    case "invalid_search":
      return {
        status: "invalid_search",
        page,
        hasNextPage: false,
        items: [],
        message: "The search input is invalid.",
      };
    case "unsupported_search":
      return {
        status: "unsupported_search",
        page,
        hasNextPage: false,
        items: [],
        message: "This search type is not supported.",
      };
    case "upstream_rate_limited":
      return {
        status: "rate_limited",
        dataSource: "pitpanda",
        page,
        hasNextPage: false,
        items: [],
        message: "Search rate limit reached. Try again shortly.",
      };
    case "configuration_error":
      return {
        status: "configuration_error",
        page,
        hasNextPage: false,
        items: [],
        message: "Search is not configured on the server.",
      };
    default:
      return {
        status: "upstream_unavailable",
        dataSource: "pitpanda",
        page,
        hasNextPage: false,
        items: [],
        message: "Item search is temporarily unavailable.",
      };
  }
}

export function itemSearchCacheKey(request: ItemSearchRequest): string {
  return createHash("sha256")
    .update(JSON.stringify(request))
    .digest("hex");
}
