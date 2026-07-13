import {
  extractBookSlots,
  resolveMysticIds,
  type InventorySource,
} from "@pitantir/shared/inventory";
import type { Job } from "../jobs/repository.js";
import { JobsRepository } from "../jobs/repository.js";
import { AccountsRepository } from "../accounts/repository.js";
import { ScansRepository, type Scan, type ScanTriggeredBy } from "./scans-repository.js";
import type { Database } from "../client.js";

export interface ScanAccountHandlerResult {
  scan: Scan;
  enqueuedProcessScan: boolean;
  resolvedMcUuid?: string | null;
  inventorySource?: string;
  observedNonces?: string[];
  observedItemUuids?: string[];
}

function asTriggeredBy(value: unknown): ScanTriggeredBy {
  if (value === "manual" || value === "retry" || value === "schedule") {
    return value;
  }
  return "schedule";
}

export class ScanAccountHandler {
  private readonly accounts: AccountsRepository;
  private readonly scans: ScansRepository;
  private readonly jobs: JobsRepository;

  constructor(
    private readonly db: Database,
    private readonly inventory: InventorySource,
  ) {
    this.accounts = new AccountsRepository(db);
    this.scans = new ScansRepository(db);
    this.jobs = new JobsRepository(db);
  }

  async handle(job: Job): Promise<ScanAccountHandlerResult> {
    const accountId = String(job.payload.accountId ?? "");
    if (!accountId) {
      throw new Error("scan_account job missing accountId");
    }

    let account = await this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    const triggeredBy = asTriggeredBy(job.payload.triggeredBy);
    const scanKey = `scan:${job.idempotencyKey ?? job.id}`;
    const { scan: begun } = await this.scans.beginScan({
      accountId,
      triggeredBy,
      idempotencyKey: scanKey,
    });

    if (begun.status === "success") {
      const enqueued = await this.enqueueProcessScan(begun.id);
      return {
        scan: begun,
        enqueuedProcessScan: enqueued,
        inventorySource: this.inventory.id,
      };
    }
    if (begun.status === "failure" || begun.status === "cancelled") {
      return { scan: begun, enqueuedProcessScan: false, inventorySource: this.inventory.id };
    }

    let scan = begun;
    if (scan.status === "queued") {
      scan = await this.scans.markRunning(scan.id);
    }

    if (!account.enabled) {
      const failed = await this.scans.markFailure(scan.id, {
        errorCode: "account_disabled",
        errorMessage: "Account is disabled",
      });
      return { scan: failed, enqueuedProcessScan: false, inventorySource: this.inventory.id };
    }

    const fetched = await this.inventory.fetchInventory({
      id: account.id,
      mcUsername: account.mcUsername,
      mcUuid: account.mcUuid,
    });

    account = (await this.accounts.get(accountId)) ?? account;
    let resolvedMcUuid: string | null = account.mcUuid;

    if (!fetched.ok) {
      const failed = await this.scans.markFailure(scan.id, {
        errorCode: fetched.errorCode,
        errorMessage: fetched.errorMessage,
      });
      return {
        scan: failed,
        enqueuedProcessScan: false,
        resolvedMcUuid,
        inventorySource: this.inventory.id,
      };
    }

    const payloadUuid =
      typeof fetched.rawInventory.uuid === "string" ? fetched.rawInventory.uuid : null;
    if (!account.mcUuid && payloadUuid) {
      await this.accounts.update(account.id, { mcUuid: payloadUuid });
      resolvedMcUuid = payloadUuid;
    }

    const success = await this.scans.markSuccess(scan.id, {
      observedAt: fetched.observedAt,
      rawInventory: fetched.rawInventory,
    });
    const enqueued = await this.enqueueProcessScan(success.id);
    const slots = extractBookSlots(fetched.rawInventory);
    const observedNonces = slots
      .map((slot) => resolveMysticIds(slot.rawItem).nonce)
      .filter((nonce): nonce is string => Boolean(nonce));
    const observedItemUuids = slots
      .map((slot) => resolveMysticIds(slot.rawItem).itemUuid)
      .filter((uuid): uuid is string => Boolean(uuid));
    return {
      scan: success,
      enqueuedProcessScan: enqueued,
      resolvedMcUuid,
      inventorySource: this.inventory.id,
      observedNonces,
      observedItemUuids,
    };
  }

  private async enqueueProcessScan(scanId: string): Promise<boolean> {
    const result = await this.jobs.enqueue({
      type: "process_scan",
      payload: { scanId },
      priority: 50,
      idempotencyKey: `process_scan:${scanId}`,
    });
    return result.created;
  }
}
