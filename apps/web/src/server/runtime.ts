import { createItemDataProvider } from "@pitantir/shared/item-data";
import { IdentityService, MemoryIdentityStore, UpstreamObservationIngestor } from "@pitantir/db";
import { getPitPandaApiKey } from "./pitpanda-key-store";

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
    pitpandaApiKey: getPitPandaApiKey(),
    providerId: process.env.ITEM_DATA_PROVIDER,
  });
}
