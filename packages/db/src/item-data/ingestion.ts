import { randomUUID } from "node:crypto";
import type { NormalizedUpstreamItem, UpstreamIngestionResult } from "@pitantir/shared/item-data";
import type { IdentityService } from "../identity/service.js";

/** System account used for upstream provider observations until mapped to tracked accounts. */
export const UPSTREAM_SYSTEM_ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";

export class UpstreamObservationIngestor {
  constructor(private readonly identityService: IdentityService) {}

  ingest(
    items: NormalizedUpstreamItem[],
    context: { searchQuery: string; retrievalId?: string },
  ): UpstreamIngestionResult {
    const retrievalId = context.retrievalId ?? randomUUID();
    const ingested = items.map((item) => {
      const rawItem = {
        ...item.rawPayload,
        _pitantir: {
          source: item.source,
          providerItemKey: item.providerItemKey,
          retrievedAt: item.retrievedAt.toISOString(),
          searchQuery: context.searchQuery,
          domainSearchQuery: item.searchQuery,
        },
      };

      const observation = this.identityService.createObservationFromRaw({
        scanId: retrievalId,
        accountId: UPSTREAM_SYSTEM_ACCOUNT_ID,
        observedAt: item.observedAt ?? item.retrievedAt,
        slotKey: `upstream:${item.source}:${item.providerItemKey}`,
        rawItem,
      });

      const resolution = this.identityService.resolveObservationAuto(observation.id);

      return {
        observationId: observation.id,
        resolutionStatus: resolution.observation.resolutionStatus,
        canonicalItemId: resolution.observation.canonicalItemId,
        providerItemKey: item.providerItemKey,
      };
    });

    return { retrievalId, ingested };
  }
}
