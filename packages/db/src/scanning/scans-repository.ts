import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { scans, type ScanRow } from "../schema/scans.js";
import { accounts } from "../schema/accounts.js";
import { newId, now } from "../identity/store.js";
import { extractBookSlots } from "@pitantir/shared/inventory";

export type ScanStatus = ScanRow["status"];
export type ScanTriggeredBy = ScanRow["triggeredBy"];
export type ScanProcessingStatus = ScanRow["processingStatus"];

export interface Scan {
  id: string;
  accountId: string;
  status: ScanStatus;
  triggeredBy: ScanTriggeredBy;
  idempotencyKey: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  observedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  rawInventoryHash: string | null;
  rawInventory: Record<string, unknown> | null;
  itemCount: number | null;
  processingStatus: ScanProcessingStatus;
  processedAt: Date | null;
  createdAt: Date;
}

export type PublicScanSummary = Omit<Scan, "rawInventory" | "idempotencyKey">;

function mapScan(row: ScanRow): Scan {
  return {
    id: row.id,
    accountId: row.accountId,
    status: row.status,
    triggeredBy: row.triggeredBy,
    idempotencyKey: row.idempotencyKey,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    observedAt: row.observedAt,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    rawInventoryHash: row.rawInventoryHash,
    rawInventory: (row.rawInventory as Record<string, unknown> | null) ?? null,
    itemCount: row.itemCount,
    processingStatus: row.processingStatus,
    processedAt: row.processedAt,
    createdAt: row.createdAt,
  };
}

export function hashRawInventory(rawInventory: Record<string, unknown>): string {
  const canonical = stableStringify(rawInventory);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortValue(record[key]);
    }
    return sorted;
  }
  return value;
}

export class ScansRepository {
  constructor(private readonly db: Database) {}

  async get(id: string): Promise<Scan | null> {
    const rows = await this.db.select().from(scans).where(eq(scans.id, id));
    return rows[0] ? mapScan(rows[0]) : null;
  }

  async listForAccount(accountId: string, limit = 50): Promise<Scan[]> {
    const rows = await this.db
      .select()
      .from(scans)
      .where(eq(scans.accountId, accountId))
      .orderBy(desc(scans.createdAt))
      .limit(limit);
    return rows.map(mapScan);
  }

  /** Operator-facing scan summary — excludes raw inventory payloads. */
  toPublicSummary(scan: Scan): PublicScanSummary {
    return {
      id: scan.id,
      accountId: scan.accountId,
      status: scan.status,
      triggeredBy: scan.triggeredBy,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt,
      observedAt: scan.observedAt,
      errorCode: scan.errorCode,
      errorMessage: scan.errorMessage,
      rawInventoryHash: scan.rawInventoryHash,
      itemCount: scan.itemCount,
      processingStatus: scan.processingStatus,
      processedAt: scan.processedAt,
      createdAt: scan.createdAt,
    };
  }

  async getByIdempotencyKey(key: string): Promise<Scan | null> {
    const rows = await this.db.select().from(scans).where(eq(scans.idempotencyKey, key));
    return rows[0] ? mapScan(rows[0]) : null;
  }

  /**
   * Create a queued scan, or return the existing row for the same idempotency key.
   */
  async beginScan(input: {
    accountId: string;
    triggeredBy: ScanTriggeredBy;
    idempotencyKey: string;
  }): Promise<{ scan: Scan; created: boolean }> {
    const existing = await this.getByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return { scan: existing, created: false };
    }

    const timestamp = now();
    const row = {
      id: newId(),
      accountId: input.accountId,
      status: "queued" as const,
      triggeredBy: input.triggeredBy,
      idempotencyKey: input.idempotencyKey,
      startedAt: null,
      finishedAt: null,
      observedAt: null,
      errorCode: null,
      errorMessage: null,
      rawInventoryHash: null,
      rawInventory: null,
      itemCount: null,
      processingStatus: "pending" as const,
      processedAt: null,
      createdAt: timestamp,
    };

    try {
      const inserted = await this.db.insert(scans).values(row).returning();
      return { scan: mapScan(inserted[0]!), created: true };
    } catch {
      const raced = await this.getByIdempotencyKey(input.idempotencyKey);
      if (!raced) throw new Error("Scan insert failed without existing idempotency row");
      return { scan: raced, created: false };
    }
  }

  async markRunning(scanId: string, asOf: Date = now()): Promise<Scan> {
    const updated = await this.db
      .update(scans)
      .set({
        status: "running",
        startedAt: asOf,
      })
      .where(and(eq(scans.id, scanId)))
      .returning();
    if (!updated[0]) throw new Error(`Scan not found: ${scanId}`);
    return mapScan(updated[0]);
  }

  async markSuccess(
    scanId: string,
    input: {
      observedAt: Date;
      rawInventory: Record<string, unknown>;
      finishedAt?: Date;
    },
  ): Promise<Scan> {
    const hash = hashRawInventory(input.rawInventory);
    const itemCount = extractBookSlots(input.rawInventory).length;
    const finishedAt = input.finishedAt ?? now();

    const updated = await this.db
      .update(scans)
      .set({
        status: "success",
        finishedAt,
        observedAt: input.observedAt,
        rawInventory: input.rawInventory,
        rawInventoryHash: hash,
        itemCount,
        errorCode: null,
        errorMessage: null,
        processingStatus: "pending",
        processedAt: null,
      })
      .where(eq(scans.id, scanId))
      .returning();
    if (!updated[0]) throw new Error(`Scan not found: ${scanId}`);

    await this.db
      .update(accounts)
      .set({ lastSuccessScanAt: input.observedAt, updatedAt: finishedAt })
      .where(eq(accounts.id, updated[0].accountId));

    return mapScan(updated[0]);
  }

  async markFailure(
    scanId: string,
    input: { errorCode: string; errorMessage: string; finishedAt?: Date },
  ): Promise<Scan> {
    const finishedAt = input.finishedAt ?? now();
    const updated = await this.db
      .update(scans)
      .set({
        status: "failure",
        finishedAt,
        observedAt: null,
        rawInventory: null,
        rawInventoryHash: null,
        itemCount: null,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage.slice(0, 4000),
        processingStatus: "skipped",
        processedAt: finishedAt,
      })
      .where(eq(scans.id, scanId))
      .returning();
    if (!updated[0]) throw new Error(`Scan not found: ${scanId}`);

    await this.db
      .update(accounts)
      .set({ lastFailureScanAt: finishedAt, updatedAt: finishedAt })
      .where(eq(accounts.id, updated[0].accountId));

    return mapScan(updated[0]);
  }

  async markProcessed(scanId: string, asOf: Date = now()): Promise<Scan> {
    const updated = await this.db
      .update(scans)
      .set({
        processingStatus: "processed",
        processedAt: asOf,
      })
      .where(eq(scans.id, scanId))
      .returning();
    if (!updated[0]) throw new Error(`Scan not found: ${scanId}`);
    return mapScan(updated[0]);
  }

  async markProcessingFailed(scanId: string, message: string, asOf: Date = now()): Promise<Scan> {
    const updated = await this.db
      .update(scans)
      .set({
        processingStatus: "failed",
        processedAt: asOf,
        errorMessage: message.slice(0, 4000),
      })
      .where(eq(scans.id, scanId))
      .returning();
    if (!updated[0]) throw new Error(`Scan not found: ${scanId}`);
    return mapScan(updated[0]);
  }
}
