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
import {
  getHypixelScansPaused,
} from "../accounts/scan-control.js";
import { isHypixelApiCircuitOpen } from "../accounts/hypixel-circuit.js";
import {
  accountIs140er,
  hotNextScanAt,
  PRESENCE_HOT_INTERVAL_SECONDS,
  PRESENCE_HOT_PRIORITY,
  resolveEffectivePresence,
} from "../accounts/presence.js";
import { isPitpalPresenceAuthoritative } from "../accounts/pitpal-lobbies.js";
import { probePitpandaNoncePresence } from "../accounts/pitpanda-presence.js";
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

    // 140ers: PitPal covers presence. Never spend Hypixel quota unless the operator
    // explicitly hits Scan now (triggeredBy=manual without a pitpal_* reason).
    const pitpalReason =
      typeof job.payload.reason === "string" && job.payload.reason.startsWith("pitpal_");
    if (accountIs140er(account) && (triggeredBy !== "manual" || pitpalReason)) {
      const failed = await this.scans.markFailure(scan.id, {
        errorCode: "skipped_140er",
        errorMessage:
          "Skipped Hypixel scan for 140er-tagged account (PitPal presence only; use Scan now to force).",
      });
      return {
        scan: failed,
        enqueuedProcessScan: false,
        inventorySource: this.inventory.id,
      };
    }

    if ((await getHypixelScansPaused(this.db)) || (await isHypixelApiCircuitOpen(this.db))) {
      const failed = await this.scans.markFailure(scan.id, {
        errorCode: "upstream_unavailable",
        errorMessage:
          "Hypixel API calls are paused (manual pause or consecutive-failure circuit). Resume from Accounts when ready.",
      });
      return {
        scan: failed,
        enqueuedProcessScan: false,
        inventorySource: this.inventory.id,
      };
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

    const presenceOpts = {
      pitpalAuthoritative: await isPitpalPresenceAuthoritative(this.db),
    };
    const previousEffective = resolveEffectivePresence(account, presenceOpts);
    const previousHash = account.lastInventoryHash;
    const presence = fetched.presence;
    const inventoryChanged =
      Boolean(success.rawInventoryHash) &&
      previousHash != null &&
      previousHash !== success.rawInventoryHash;

    const hypixelSession =
      presence?.gameType || presence?.mode
        ? [presence.gameType, presence.mode].filter(Boolean).join("/")
        : null;
    // Prefer live PitPal lobby/status on the roster when we have it; else Hypixel session.
    const sessionGame =
      account.lastPitpalLobby || account.lastPitpalLocation
        ? [
            account.lastPitpalLobby,
            account.lastPitpalLocation,
            account.lastPitpalIsNicked === true ? "Nicked" : null,
          ]
            .filter(Boolean)
            .join(" · ") || hypixelSession
        : hypixelSession;

    // Optional weak PitPanda nonce hint when Hypixel looks offline.
    let pitpandaHintDetail: string | null = null;
    if (presence?.online !== true) {
      const apiKey = process.env.PITPANDA_API_KEY?.trim();
      const nonce = extractBookSlots(fetched.rawInventory)
        .map((slot) => resolveMysticIds(slot.rawItem).nonce)
        .find((value): value is string => Boolean(value));
      if (apiKey && nonce) {
        const hint = await probePitpandaNoncePresence({ apiKey, nonce }).catch(() => null);
        if (hint?.ok && hint.hintOnline) {
          pitpandaHintDetail = `PitPanda lastseen fresh · ${hint.lastSeenAt}`;
        }
      }
    }

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

    const nextEffective = resolveEffectivePresence(account, presenceOpts);
    // PitPal lobbies are SoT when the feed is fresh — Hypixel alone cannot
    // mark someone online, and API Off cannot mark them offline.
    const cameOnline = nextEffective.online && !previousEffective.online;
    const wentOffline = !nextEffective.online && previousEffective.online;

    // Hotspot: keep online non-140er accounts on a short cadence.
    // 140ers are never auto Hypixel-scanned.
    if (nextEffective.online && !accountIs140er(account)) {
      const hotAt = hotNextScanAt(
        fetched.observedAt,
        account.id.split("").reduce((n, c) => n + c.charCodeAt(0), 0),
      );
      try {
        await this.accounts.update(account.id, {
          priority: Math.min(account.priority, PRESENCE_HOT_PRIORITY),
          ...(account.nextScanAt.getTime() >
          fetched.observedAt.getTime() + PRESENCE_HOT_INTERVAL_SECONDS * 1000
            ? { nextScanAt: hotAt }
            : {}),
        });
      } catch {
        // schedule bump is best-effort
      }
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
        isNicked: account.lastPitpalIsNicked === true ? true : null,
        detail: nextEffective.apiOff
          ? [sessionGame, "API Off"].filter(Boolean).join(" · ")
          : sessionGame,
      });
    } else if (wentOffline) {
      liveEvents.push({
        id: newId(),
        kind: "went_offline",
        accountId: account.id,
        mcUsername: account.mcUsername,
        at,
        isNicked: account.lastPitpalIsNicked === true ? true : null,
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
        isNicked: account.lastPitpalIsNicked === true ? true : null,
      });
    }
    liveEvents.push({
      id: newId(),
      kind: "scanned",
      accountId: account.id,
      mcUsername: account.mcUsername,
      at,
      isNicked: account.lastPitpalIsNicked === true ? true : null,
      detail: nextEffective.apiOff
        ? [sessionGame, "API Off", pitpandaHintDetail].filter(Boolean).join(" · ") || "API Off"
        : presence?.online === true
          ? sessionGame
            ? `online · ${sessionGame}`
            : "online"
          : presence?.online === false
            ? pitpandaHintDetail
              ? `offline · ${pitpandaHintDetail}`
              : "offline"
            : pitpandaHintDetail ?? "presence unknown",
    });
    await appendHypixelLiveEvents(this.db, liveEvents).catch(() => undefined);
    await notifyDiscordForLiveEvents(this.db, liveEvents, {
      accountId: account.id,
      // Dashboard / still-online pings follow effective presence (incl. API Off).
      presenceOnline: nextEffective.online,
      mcUsername: account.mcUsername,
      sessionGame: nextEffective.apiOff
        ? [sessionGame, "API Off"].filter(Boolean).join(" · ")
        : sessionGame,
      at,
      isNicked: account.lastPitpalIsNicked === true ? true : null,
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
      presenceOnline: nextEffective.online,
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
