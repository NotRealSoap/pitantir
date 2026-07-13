import { createItemDataProvider } from "@pitantir/shared/item-data";
import { IdentityService, MemoryIdentityStore, UpstreamObservationIngestor } from "@pitantir/db";

let identityService: IdentityService | null = null;
let ingestor: UpstreamObservationIngestor | null = null;

export function getIdentityService(): IdentityService {
  if (!identityService) {
    identityService = new IdentityService(new MemoryIdentityStore());
  }
  return identityService;
}

export function getUpstreamIngestor(): UpstreamObservationIngestor {
  if (!ingestor) {
    ingestor = new UpstreamObservationIngestor(getIdentityService());
  }
  return ingestor;
}

export function getItemDataProvider() {
  return createItemDataProvider({
    pitpandaApiKey: process.env.PITPANDA_API_KEY,
    providerId: process.env.ITEM_DATA_PROVIDER,
  });
}
