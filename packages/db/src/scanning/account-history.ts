import type { CanonicalItem, Observation } from "@pitantir/shared/identity";
import { extractBookSlots } from "@pitantir/shared/inventory";
import type { Database } from "../client.js";
import type { PublicAccount } from "../accounts/repository.js";
import { AccountsRepository } from "../accounts/repository.js";
import type { IdentityStore } from "../identity/store.js";
import { ScansRepository, type PublicScanSummary } from "./scans-repository.js";

export interface HeldItemSummary {
  itemId: string;
  displayName: string | null;
  primaryNonce: string | null;
  category: CanonicalItem["category"];
  identityConfidence: CanonicalItem["identityConfidence"];
  strictFingerprint: string | null;
  presenceStartedAt: Date;
  certainty: string;
}

export interface ObservedItemSummary {
  observationId: string;
  scanId: string;
  slotKey: string;
  title: string | null;
  nonce: string | null;
  kind: string | null;
  customEnchants: Record<string, number> | null;
  lore: string[] | null;
  resolutionStatus: Observation["resolutionStatus"] | "pending_process";
  canonicalItemId: string | null;
}

export interface AccountHistory {
  account: PublicAccount;
  scans: PublicScanSummary[];
  failures: PublicScanSummary[];
  heldItems: HeldItemSummary[];
  /** Mystics/books seen on the latest successful scan (includes nonces even before presence UI). */
  latestObservedItems: ObservedItemSummary[];
}

function asNumberRecord(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function summarizeObservation(observation: Observation): ObservedItemSummary {
  const raw = observation.rawItem;
  const lore = Array.isArray(raw.lore) ? raw.lore.map(String) : null;
  return {
    observationId: observation.id,
    scanId: observation.scanId,
    slotKey: observation.slotKey,
    title:
      observation.normalizedMetadata.title ??
      (typeof raw.title === "string" ? raw.title : null),
    nonce: observation.observedNonce,
    kind: typeof raw.kind === "string" ? raw.kind : null,
    customEnchants: asNumberRecord(raw.customEnchants),
    lore,
    resolutionStatus: observation.resolutionStatus,
    canonicalItemId: observation.canonicalItemId,
  };
}

function summarizeRawSlot(
  scanId: string,
  slotKey: string,
  rawItem: Record<string, unknown>,
): ObservedItemSummary {
  const lore = Array.isArray(rawItem.lore) ? rawItem.lore.map(String) : null;
  return {
    observationId: `pending:${scanId}:${slotKey}`,
    scanId,
    slotKey,
    title: typeof rawItem.title === "string" ? rawItem.title : null,
    nonce: typeof rawItem.nonce === "string" ? rawItem.nonce : null,
    kind: typeof rawItem.kind === "string" ? rawItem.kind : null,
    customEnchants: asNumberRecord(rawItem.customEnchants),
    lore,
    resolutionStatus: "pending_process",
    canonicalItemId: null,
  };
}

export class AccountHistoryService {
  private readonly accounts: AccountsRepository;
  private readonly scans: ScansRepository;

  constructor(
    db: Database,
    private readonly identityStore: IdentityStore,
  ) {
    this.accounts = new AccountsRepository(db);
    this.scans = new ScansRepository(db);
  }

  async getHistory(accountId: string): Promise<AccountHistory | null> {
    const account = await this.accounts.get(accountId);
    if (!account) {
      return null;
    }

    const allScans = await this.scans.listForAccount(accountId);
    const summaries = allScans.map((scan) => this.scans.toPublicSummary(scan));
    const failures = summaries.filter((scan) => scan.status === "failure");

    const openPeriods = await this.identityStore.listOpenPresenceOnAccount(accountId);
    const heldItems: HeldItemSummary[] = [];
    for (const period of openPeriods) {
      if (period.isUnknownGap || !period.itemId) continue;
      const item = await this.identityStore.getCanonicalItem(period.itemId);
      if (!item || item.status !== "active") continue;
      heldItems.push({
        itemId: item.id,
        displayName: item.displayName,
        primaryNonce: item.primaryNonce,
        category: item.category,
        identityConfidence: item.identityConfidence,
        strictFingerprint: item.strictFingerprint,
        presenceStartedAt: period.startedAt,
        certainty: period.certainty,
      });
    }

    heldItems.sort((a, b) => b.presenceStartedAt.getTime() - a.presenceStartedAt.getTime());

    const latestSuccess = allScans.find((scan) => scan.status === "success");
    let latestObservedItems: ObservedItemSummary[] = [];
    if (latestSuccess) {
      const observations = await this.identityStore.listObservationsForScan(latestSuccess.id);
      if (observations.length > 0) {
        latestObservedItems = observations.map(summarizeObservation);
      } else if (latestSuccess.rawInventory) {
        // Same nonces the worker logs, available before process_scan finishes.
        latestObservedItems = extractBookSlots(latestSuccess.rawInventory).map((slot) =>
          summarizeRawSlot(latestSuccess.id, slot.slotKey, slot.rawItem),
        );
      }
    }
    latestObservedItems.sort((a, b) => a.slotKey.localeCompare(b.slotKey));

    return {
      account,
      scans: summaries,
      failures,
      heldItems,
      latestObservedItems,
    };
  }
}
