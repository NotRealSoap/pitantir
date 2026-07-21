import {
  diffInventoriesByNonce,
  extractBookSlots,
  formatInventoryChangeDetail,
  resolveMysticIds,
  type InventorySource,
} from "@pitantir/shared/inventory";
import type { Job } from "../jobs/repository.js";
import { JobsRepository } from "../jobs/repository.js";
import { AccountsRepository } from "../accounts/repository.js";
import {
  appendHypixelLiveEvents,
  type HypixelLiveEvent,
} from "../accounts/live-events.js";
import { notifyDiscordForLiveEvents } from "../accounts/discord-webhook.js";
import { ScansRepository, type Scan, type ScanTriggeredBy } from "./scans-repository.js";
import type { Database } from "../client.js";
import { newId } from "../identity/store.js";

export interface ScanAccountHandlerResult {
  scan: Scan;
  enqueuedProcessScan: boolean;
  resolvedMcUuid?: string | null;
  inventorySource?: string;
  observedNonces?: string[];
  observedItemUuids?: string[];
  inventoryChanged?: boolean;
  cameOnline?: boolean;
  presenceOnline?: boolean | null;
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

    // Persist Hypixel/Mojang identity from the scan payload (correct UUID + in-game casing).
    const payloadUuid =
      typeof fetched.rawInventory.uuid === "string" ? fetched.rawInventory.uuid : null;
    const displaynameRaw =
      typeof fetched.rawInventory.displayname === "string"
        ? fetched.rawInventory.displayname.trim()
        : "";
    const displayname = /^[A-Za-z0-9_]{3,16}$/.test(displaynameRaw) ? displaynameRaw : null;

    const identityPatch: { mcUuid?: string; mcUsername?: string } = {};
    if (payloadUuid) identityPatch.mcUuid = payloadUuid;
    if (displayname) identityPatch.mcUsername = displayname;

    if (Object.keys(identityPatch).length > 0) {
      try {
        account = await this.accounts.update(account.id, identityPatch);
        resolvedMcUuid = account.mcUuid;
      } catch (error) {
        // Unique collision on username is unlikely for case-only fixes; still keep UUID if we can.
        if (identityPatch.mcUuid && identityPatch.mcUuid !== account.mcUuid) {
          try {
            account = await this.accounts.update(account.id, { mcUuid: identityPatch.mcUuid });
            resolvedMcUuid = account.mcUuid;
          } catch {
            // leave account as-is
          }
        }
        void error;
      }
    }

    const success = await this.scans.markSuccess(scan.id, {
      observedAt: fetched.observedAt,
      rawInventory: fetched.rawInventory,
    });

    const previousOnline = account.lastHypixelOnline;
    const previousHash = account.lastInventoryHash;
    const presence = fetched.presence;
    const inventoryChanged =
      Boolean(success.rawInventoryHash) &&
      previousHash != null &&
      previousHash !== success.rawInventoryHash;
    // Only emit transitions once we have a prior observation (avoid noise on first scan).
    const cameOnline = presence?.online === true && previousOnline === false;
    const wentOffline = presence?.online === false && previousOnline === true;

    const sessionGame =
      presence?.gameType || presence?.mode
        ? [presence.gameType, presence.mode].filter(Boolean).join("/")
        : null;

    try {
      account = await this.accounts.update(account.id, {
        lastHypixelOnline: presence?.online ?? null,
        lastHypixelOnlineAt: presence ? fetched.observedAt : account.lastHypixelOnlineAt,
        lastPresenceSource: presence?.source ?? null,
        lastSessionGame: sessionGame,
        lastInventoryHash: success.rawInventoryHash,
        lastInventoryChangedAt: inventoryChanged
          ? fetched.observedAt
          : account.lastInventoryChangedAt,
      });
    } catch {
      // Presence metadata is best-effort; scan already succeeded.
    }

    const liveEvents: HypixelLiveEvent[] = [];
    const at = fetched.observedAt.toISOString();
    if (cameOnline) {
      liveEvents.push({
        id: newId(),
        kind: "came_online",
        accountId: account.id,
        mcUsername: account.mcUsername,
        at,
        detail: sessionGame,
      });
    } else if (wentOffline) {
      liveEvents.push({
        id: newId(),
        kind: "went_offline",
        accountId: account.id,
        mcUsername: account.mcUsername,
        at,
      });
    }
    if (inventoryChanged) {
      let detail = `${success.itemCount ?? 0} mystic slot(s)`;
      let changes: HypixelLiveEvent["changes"] = null;
      try {
        const recent = await this.scans.listForAccount(account.id, 8);
        const previousSuccess = recent.find(
          (row) =>
            row.id !== success.id &&
            row.status === "success" &&
            row.rawInventory != null,
        );
        if (previousSuccess?.rawInventory) {
          const diff = diffInventoriesByNonce(
            previousSuccess.rawInventory,
            fetched.rawInventory,
          );
          changes = diff.changes;
          detail = formatInventoryChangeDetail(diff);
        }
      } catch {
        // keep slot-count fallback
      }
      liveEvents.push({
        id: newId(),
        kind: "inventory_changed",
        accountId: account.id,
        mcUsername: account.mcUsername,
        at,
        detail,
        changes,
      });
    }
    liveEvents.push({
      id: newId(),
      kind: "scanned",
      accountId: account.id,
      mcUsername: account.mcUsername,
      at,
      detail:
        presence?.online === true
          ? sessionGame
            ? `online · ${sessionGame}`
            : "online"
          : presence?.online === false
            ? "offline"
            : "presence unknown",
    });
    await appendHypixelLiveEvents(this.db, liveEvents).catch(() => undefined);
    await notifyDiscordForLiveEvents(this.db, liveEvents, {
      accountId: account.id,
      presenceOnline: presence?.online ?? null,
      mcUsername: account.mcUsername,
      sessionGame,
      at,
    }).catch(() => undefined);

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
      inventoryChanged,
      cameOnline,
      presenceOnline: presence?.online ?? null,
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
