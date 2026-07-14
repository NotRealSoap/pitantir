import type { CanonicalItem, Observation } from "@pitantir/shared/identity";
import { extractBookSlots, resolveMysticIds, resolveMysticLives } from "@pitantir/shared/inventory";
import type { Database } from "../client.js";
import type { PublicAccount } from "../accounts/repository.js";
import { AccountsRepository } from "../accounts/repository.js";
import type { IdentityStore } from "../identity/store.js";
import { ScansRepository, type PublicScanSummary } from "./scans-repository.js";

export interface HeldItemSummary {
  itemId: string;
  /** Open presence period id — unique even if multiple periods exist for one item. */
  periodId: string;
  displayName: string | null;
  primaryNonce: string | null;
  category: CanonicalItem["category"];
  identityConfidence: CanonicalItem["identityConfidence"];
  strictFingerprint: string | null;
  presenceStartedAt: Date;
  certainty: string;
  startReason: string;
}

export interface ObservedItemSummary {
  observationId: string;
  scanId: string;
  slotKey: string;
  title: string | null;
  /** Mystic Nonce — primary tracking id */
  nonce: string | null;
  /** ExtraAttributes item UUID when present (distinct from nonce) */
  itemUuid: string | null;
  kind: string | null;
  customEnchants: Record<string, number> | null;
  lore: string[] | null;
  lives: number | null;
  maxLives: number | null;
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

/** Prefer confirmed scan presence over uncertain import duplicates for the same item. */
function heldPeriodRank(certainty: string, startReason: string): number {
  if (certainty === "confirmed") return 300;
  if (certainty === "uncertain" && startReason !== "import") return 200;
  if (certainty === "uncertain") return 100;
  return 0;
}

function preferHeldItem(a: HeldItemSummary, b: HeldItemSummary): HeldItemSummary {
  const rankDiff = heldPeriodRank(b.certainty, b.startReason) - heldPeriodRank(a.certainty, a.startReason);
  if (rankDiff !== 0) return rankDiff > 0 ? b : a;
  // Same tier: keep the earliest open presence (when we first believed it was held here).
  return a.presenceStartedAt.getTime() <= b.presenceStartedAt.getTime() ? a : b;
}

/** Collapse duplicate open periods for the same canonical item (e.g. scan + PitPanda import). */
export function dedupeHeldItemsByItemId(items: HeldItemSummary[]): HeldItemSummary[] {
  const heldByItemId = new Map<string, HeldItemSummary>();
  for (const item of items) {
    const existing = heldByItemId.get(item.itemId);
    heldByItemId.set(item.itemId, existing ? preferHeldItem(existing, item) : item);
  }
  return [...heldByItemId.values()].sort(
    (a, b) => b.presenceStartedAt.getTime() - a.presenceStartedAt.getTime(),
  );
}

function summarizeSlot(
  scanId: string,
  slotKey: string,
  rawItem: Record<string, unknown>,
  observation?: Observation,
): ObservedItemSummary {
  const ids = resolveMysticIds(rawItem);
  const lives = resolveMysticLives(rawItem);
  const lore = Array.isArray(rawItem.lore) ? rawItem.lore.map(String) : null;
  return {
    observationId: observation?.id ?? `pending:${scanId}:${slotKey}`,
    scanId,
    slotKey,
    title:
      observation?.normalizedMetadata.title ??
      (typeof rawItem.title === "string" ? rawItem.title : null),
    // Prefer live raw ids (what worker logs); fall back to observation.observedNonce.
    nonce: ids.nonce ?? observation?.observedNonce ?? null,
    itemUuid: ids.itemUuid,
    kind: typeof rawItem.kind === "string" ? rawItem.kind : null,
    customEnchants: asNumberRecord(rawItem.customEnchants),
    lore,
    lives: lives.lives,
    maxLives: lives.maxLives,
    resolutionStatus: observation?.resolutionStatus ?? "pending_process",
    canonicalItemId: observation?.canonicalItemId ?? null,
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
    const heldCandidates: HeldItemSummary[] = [];
    for (const period of openPeriods) {
      if (period.isUnknownGap || !period.itemId) continue;
      const item = await this.identityStore.getCanonicalItem(period.itemId);
      if (!item || item.status !== "active") continue;
      heldCandidates.push({
        itemId: item.id,
        periodId: period.id,
        displayName: item.displayName,
        primaryNonce: item.primaryNonce,
        category: item.category,
        identityConfidence: item.identityConfidence,
        strictFingerprint: item.strictFingerprint,
        presenceStartedAt: period.startedAt,
        certainty: period.certainty,
        startReason: period.startReason,
      });
    }

    const heldItems = dedupeHeldItemsByItemId(heldCandidates);

    const latestSuccess = allScans.find((scan) => scan.status === "success");
    let latestObservedItems: ObservedItemSummary[] = [];
    if (latestSuccess?.rawInventory) {
      const observations = await this.identityStore.listObservationsForScan(latestSuccess.id);
      const bySlot = new Map(observations.map((observation) => [observation.slotKey, observation]));
      // Always derive nonce/uuid from the scan payload (same source as worker logs).
      latestObservedItems = extractBookSlots(latestSuccess.rawInventory).map((slot) =>
        summarizeSlot(latestSuccess.id, slot.slotKey, slot.rawItem, bySlot.get(slot.slotKey)),
      );
    } else if (latestSuccess) {
      const observations = await this.identityStore.listObservationsForScan(latestSuccess.id);
      latestObservedItems = observations.map((observation) =>
        summarizeSlot(latestSuccess.id, observation.slotKey, observation.rawItem, observation),
      );
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
