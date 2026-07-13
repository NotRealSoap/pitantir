import type {
  CanonicalItem,
  IdentityDecision,
  ItemIdentifier,
  ItemLocationPeriod,
  Observation,
} from "@pitantir/shared/identity";
import type { IdentityStore } from "./store.js";

export interface IdentitySnapshot {
  items: CanonicalItem[];
  identifiers: ItemIdentifier[];
  observations: Observation[];
  locationPeriods: ItemLocationPeriod[];
}

export function captureSnapshot(
  store: IdentityStore,
  itemIds: string[],
  observationIds: string[] = [],
): IdentitySnapshot {
  const items = itemIds
    .map((itemId) => store.getCanonicalItem(itemId))
    .filter((item): item is CanonicalItem => item !== null);

  const identifiers = itemIds.flatMap((itemId) => store.listIdentifiersForItem(itemId));

  const observations = observationIds
    .map((observationId) => store.getObservation(observationId))
    .filter((observation): observation is Observation => observation !== null);

  const locationPeriods = itemIds.flatMap((itemId) => store.listLocationPeriodsForItem(itemId));

  return {
    items: structuredClone(items),
    identifiers: structuredClone(identifiers),
    observations: structuredClone(observations),
    locationPeriods: structuredClone(locationPeriods),
  };
}

export function restoreSnapshot(store: IdentityStore, snapshot: IdentitySnapshot): void {
  for (const item of snapshot.items) {
    store.updateCanonicalItem(item.id, item);
  }

  for (const observation of snapshot.observations) {
    store.updateObservationResolution(observation.id, {
      canonicalItemId: observation.canonicalItemId,
      resolutionStatus: observation.resolutionStatus,
      confidence: observation.confidence,
      resolutionNote: observation.resolutionNote,
      resolvedAt: observation.resolvedAt,
      resolvedBy: observation.resolvedBy,
    });
  }

  for (const itemId of snapshot.items.map((item) => item.id)) {
    store.supersedeLocationPeriodsForItem(itemId, new Date());
  }

  for (const period of snapshot.locationPeriods) {
    store.createLocationPeriod({
      itemId: period.itemId,
      accountId: period.accountId,
      startedAt: period.startedAt,
      endedAt: period.endedAt,
      startReason: period.startReason,
      endReason: period.endReason,
      certainty: period.certainty,
      isUnknownGap: period.isUnknownGap,
      openingObservationId: period.openingObservationId,
      closingObservationContextScanId: period.closingObservationContextScanId,
      notes: period.notes,
    });
  }
}

export function decisionState(snapshot: IdentitySnapshot): Record<string, unknown> {
  return structuredClone(snapshot) as unknown as Record<string, unknown>;
}

export function isDecisionReversible(decision: IdentityDecision): boolean {
  return decision.reversedByDecisionId === null && decision.decisionType !== "revert";
}
