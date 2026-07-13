import type { Observation } from "@pitantir/shared/identity";
import type { Job } from "../jobs/repository.js";
import type { IdentityService } from "../identity/service.js";
import { ScansRepository, type Scan, hashRawInventory } from "./scans-repository.js";
import { upsertObservationsFromScan } from "./observation-extractor.js";
import type { Database } from "../client.js";

export interface ProcessScanHandlerResult {
  scan: Scan;
  observations: Observation[];
  resolvedCount: number;
}

/**
 * process_scan: extract observations → auto-resolve → location stub (via ensurePresencePeriod).
 */
export class ProcessScanHandler {
  private readonly scans: ScansRepository;

  constructor(
    db: Database,
    private readonly identity: IdentityService,
  ) {
    this.scans = new ScansRepository(db);
  }

  async handle(job: Job): Promise<ProcessScanHandlerResult> {
    const scanId = String(job.payload.scanId ?? "");
    if (!scanId) {
      throw new Error("process_scan job missing scanId");
    }

    const scan = await this.scans.get(scanId);
    if (!scan) {
      throw new Error(`Scan not found: ${scanId}`);
    }

    if (scan.status !== "success") {
      if (scan.processingStatus === "pending") {
        await this.scans.markProcessingFailed(
          scan.id,
          `Cannot process scan in status=${scan.status}`,
        );
      }
      return { scan, observations: [], resolvedCount: 0 };
    }

    if (scan.processingStatus === "processed") {
      const existing = await this.identity.listObservationsForScan(scan.id);
      return {
        scan,
        observations: existing,
        resolvedCount: existing.filter(
          (o) => o.resolutionStatus === "resolved" || o.resolutionStatus === "manually_resolved",
        ).length,
      };
    }

    try {
      if (scan.rawInventory && scan.rawInventoryHash) {
        const hash = hashRawInventory(scan.rawInventory);
        if (hash !== scan.rawInventoryHash) {
          throw new Error("raw inventory hash mismatch");
        }
      }

      const upserted = await upsertObservationsFromScan(this.identity, scan);
      let resolvedCount = 0;
      for (const observation of upserted.observations) {
        const result = await this.identity.resolveObservationAuto(observation.id);
        if (
          result.observation.resolutionStatus === "resolved" ||
          result.observation.resolutionStatus === "manually_resolved"
        ) {
          resolvedCount += 1;
        }
      }

      // Location updates for confirmed presence happen inside resolveObservationAuto.
      // Full disappearance / move rules remain T25–T28.

      const processed = await this.scans.markProcessed(scan.id);
      const observations = await this.identity.listObservationsForScan(scan.id);
      return { scan: processed, observations, resolvedCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await this.scans.markProcessingFailed(scan.id, message);
      throw Object.assign(error instanceof Error ? error : new Error(message), {
        scan: failed,
      });
    }
  }
}
