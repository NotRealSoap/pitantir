import { createHash } from "node:crypto";
import type {
  ItemDataProvider,
  ItemSearchInput,
  ItemSearchKind,
  ItemSearchPage,
  NormalizedUpstreamItem,
  ProviderCapabilities,
} from "../../types.js";
import { ItemSearchError } from "../../types.js";
import { pitPandaItemSearch, type PitPandaClientOptions } from "./client.js";
import { buildPitPandaSearchQuery } from "./query.js";
import { domainSearchQueryLabel } from "../../schemas.js";

export const PITPANDA_PROVIDER_ID = "pitpanda";

export class PitPandaItemDataProvider implements ItemDataProvider {
  readonly id = PITPANDA_PROVIDER_ID;

  readonly capabilities: ProviderCapabilities = {
    globalItemSearch: true,
    searchByExactNonce: true,
    searchByCurrentOwner: true,
    searchByPastOwner: true,
    playerInventorySnapshot: false,
  };

  constructor(private readonly options: PitPandaClientOptions) {}

  supports(kind: ItemSearchKind): boolean {
    switch (kind) {
      case "exact_nonce":
        return this.capabilities.searchByExactNonce;
      case "current_owner":
        return this.capabilities.searchByCurrentOwner;
      case "past_owner":
        return this.capabilities.searchByPastOwner;
      default:
        return false;
    }
  }

  async searchItems(input: ItemSearchInput): Promise<ItemSearchPage> {
    if (!this.supports(input.kind)) {
      throw new ItemSearchError("unsupported_search", "Provider does not support this search kind");
    }

    const pitpandaQuery = buildPitPandaSearchQuery(input);
    const result = await pitPandaItemSearch(this.options, pitpandaQuery, input.page);
    const retrievedAt = new Date();
    const searchQuery = domainSearchQueryLabel(input);

    const items = result.items.map((raw, index) =>
      normalizePitPandaItem(raw, {
        page: input.page,
        index,
        retrievedAt,
        searchQuery,
      }),
    );

    return {
      items,
      page: input.page,
      hasNextPage: items.length > 0,
    };
  }
}

function normalizePitPandaItem(
  raw: unknown,
  context: {
    page: number;
    index: number;
    retrievedAt: Date;
    searchQuery: string;
  },
): NormalizedUpstreamItem {
  const rawPayload =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : { value: raw };

  return {
    source: PITPANDA_PROVIDER_ID,
    providerItemKey: buildProviderItemKey(rawPayload, context.page, context.index),
    observedAt: null,
    retrievedAt: context.retrievedAt,
    searchQuery: context.searchQuery,
    rawPayload,
  };
}

function buildProviderItemKey(
  rawPayload: Record<string, unknown>,
  page: number,
  index: number,
): string {
  const digest = createHash("sha256").update(JSON.stringify(rawPayload)).digest("hex").slice(0, 16);
  return `page${page}:idx${index}:${digest}`;
}
