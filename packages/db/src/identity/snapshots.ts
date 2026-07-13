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

export async function captureSnapshot(
  store: IdentityStore,
  itemIds: string[],
  observationIds: string[] = [],
): Promise<IdentitySnapshot> {
  const itemResults = await Promise.all(itemIds.map((itemId) => store.getCanonicalItem(itemId)));
  const items = itemResults.filter((item): item is CanonicalItem => item !== null);

  const identifiersArrays = await Promise.all(
    itemIds.map((itemId) => store.listIdentifiersForItem(itemId)),
  );
  const identifiers = identifiersArrays.flat();

  const observationResults = await Promise.all(
    observationIds.map((observationId) => store.getObservation(observationId)),
  );
  const observations = observationResults.filter(
    (observation): observation is Observation => observation !== null,
  );

  const locationPeriodsArrays = await Promise.all(
    itemIds.map((itemId) => store.listLocationPeriodsForItem(itemId)),
  );
  const locationPeriods = locationPeriodsArrays.flat();

  return {
    items: structuredClone(items),
    identifiers: structuredClone(identifiers),
    observations: structuredClone(observations),
    locationPeriods: structuredClone(locationPeriods),
  };
}

export async function restoreSnapshot(
  store: IdentityStore,
  snapshot: IdentitySnapshot,
): Promise<void> {
  for (const item of snapshot.items) {
    await store.updateCanonicalItem(item.id, item);
  }

  for (const observation of snapshot.observations) {
    await store.updateObservationResolution(observation.id, {
      canonicalItemId: observation.canonicalItemId,
      resolutionStatus: observation.resolutionStatus,
      confidence: observation.confidence,
      resolutionNote: observation.resolutionNote,
      resolvedAt: observation.resolvedAt,
      resolvedBy: observation.resolvedBy,
    });
  }

  for (const itemId of snapshot.items.map((item) => item.id)) {
    await store.supersedeLocationPeriodsForItem(itemId, new Date());
  }

  for (const period of snapshot.locationPeriods) {
    await store.createLocationPeriod({
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
