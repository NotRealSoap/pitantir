import type { ItemDataProvider, ItemSearchKind } from "./types.js";
import { ItemSearchError } from "./types.js";
import { PitPandaItemDataProvider } from "./providers/pitpanda/adapter.js";

export class CompositeItemDataProvider implements ItemDataProvider {
  readonly id = "composite";
  readonly capabilities;

  constructor(private readonly providers: ItemDataProvider[]) {
    this.capabilities = {
      globalItemSearch: providers.some((provider) => provider.capabilities.globalItemSearch),
      searchByExactNonce: providers.some((provider) => provider.capabilities.searchByExactNonce),
      searchByCurrentOwner: providers.some(
        (provider) => provider.capabilities.searchByCurrentOwner,
      ),
      searchByPastOwner: providers.some((provider) => provider.capabilities.searchByPastOwner),
      playerInventorySnapshot: providers.some(
        (provider) => provider.capabilities.playerInventorySnapshot,
      ),
    };
  }

  supports(kind: ItemSearchKind): boolean {
    return this.providers.some((provider) => provider.supports(kind));
  }

  async searchItems(input: Parameters<ItemDataProvider["searchItems"]>[0]) {
    const provider = this.providers.find((candidate) => candidate.supports(input.kind));
    if (!provider) {
      throw new ItemSearchError("unsupported_search", "No configured provider supports this search");
    }
    return provider.searchItems(input);
  }
}

export interface ItemDataProviderFactoryConfig {
  pitpandaApiKey?: string | undefined;
  providerId?: string | undefined;
}

export function createItemDataProvider(config: ItemDataProviderFactoryConfig): ItemDataProvider {
  const providerId = config.providerId ?? "pitpanda";
  const providers: ItemDataProvider[] = [];

  if (providerId === "pitpanda" || providerId === "composite") {
    if (!config.pitpandaApiKey) {
      throw new ItemSearchError("upstream_unavailable", "PitPanda provider is not configured");
    }
    providers.push(new PitPandaItemDataProvider({ apiKey: config.pitpandaApiKey }));
  }

  if (providers.length === 0) {
    throw new ItemSearchError("unsupported_search", `Unknown item data provider: ${providerId}`);
  }

  if (providerId === "composite" && providers.length > 1) {
    return new CompositeItemDataProvider(providers);
  }

  return providers[0]!;
}
