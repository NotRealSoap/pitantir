export const ITEM_SEARCH_KINDS = ["exact_nonce", "current_owner", "past_owner"] as const;
export type ItemSearchKind = (typeof ITEM_SEARCH_KINDS)[number];

export interface ProviderCapabilities {
  globalItemSearch: boolean;
  searchByExactNonce: boolean;
  searchByCurrentOwner: boolean;
  searchByPastOwner: boolean;
  playerInventorySnapshot: boolean;
}

export interface ItemSearchInput {
  kind: ItemSearchKind;
  value: string;
  page: number;
}

export interface NormalizedUpstreamItem {
  source: string;
  providerItemKey: string;
  observedAt: Date | null;
  retrievedAt: Date;
  searchQuery: string;
  rawPayload: Record<string, unknown>;
}

export interface ItemSearchPage {
  items: NormalizedUpstreamItem[];
  page: number;
  hasNextPage: boolean;
}

export interface ItemDataProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  supports(kind: ItemSearchKind): boolean;
  searchItems(input: ItemSearchInput): Promise<ItemSearchPage>;
}

export type ItemSearchErrorCode =
  | "invalid_search"
  | "unsupported_search"
  | "configuration_error"
  | "upstream_unavailable"
  | "upstream_rate_limited"
  | "upstream_unauthorized"
  | "no_results";

export const ITEM_DATA_SOURCES = ["pitpanda", "local_database"] as const;
export type ItemDataSource = (typeof ITEM_DATA_SOURCES)[number];

export class ItemSearchError extends Error {
  constructor(
    readonly code: ItemSearchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ItemSearchError";
  }
}

export interface IngestedUpstreamObservation {
  observationId: string;
  resolutionStatus: string;
  canonicalItemId: string | null;
  providerItemKey: string;
}

export interface UpstreamIngestionResult {
  retrievalId: string;
  ingested: IngestedUpstreamObservation[];
}
