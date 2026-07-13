import { extractBookSlots } from "@pitantir/shared";
import type { Observation } from "@pitantir/shared/identity";
import type { IdentityService } from "../identity/service.js";
import type { Scan } from "./scans-repository.js";
import { hashRawInventory } from "./scans-repository.js";

export interface ObservationUpsertResult {
  observations: Observation[];
  extractedCount: number;
  createdOrExistingCount: number;
}

/**
 * Idempotent observation extraction from a successful scan's raw inventory.
 */
export async function upsertObservationsFromScan(
  identity: IdentityService,
  scan: Scan,
): Promise<ObservationUpsertResult> {
  if (scan.status !== "success") {
    throw new Error(`Cannot extract observations from non-success scan ${scan.id}`);
  }
  if (!scan.rawInventory || !scan.rawInventoryHash || !scan.observedAt) {
    throw new Error(`Scan ${scan.id} is missing raw inventory payload`);
  }

  const hash = hashRawInventory(scan.rawInventory);
  if (hash !== scan.rawInventoryHash) {
    throw new Error(`Scan ${scan.id} raw inventory hash mismatch; refusing to process`);
  }

  const slots = extractBookSlots(scan.rawInventory);
  const observations: Observation[] = [];
  for (const slot of slots) {
    const observation = await identity.createObservationFromRaw({
      scanId: scan.id,
      accountId: scan.accountId,
      observedAt: scan.observedAt,
      slotKey: slot.slotKey,
      rawItem: slot.rawItem,
    });
    observations.push(observation);
  }

  return {
    observations,
    extractedCount: slots.length,
    createdOrExistingCount: observations.length,
  };
}
