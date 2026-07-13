import type { CanonicalItem } from "@pitantir/shared/identity";
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

export interface AccountHistory {
  account: PublicAccount;
  scans: PublicScanSummary[];
  failures: PublicScanSummary[];
  heldItems: HeldItemSummary[];
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

    return {
      account,
      scans: summaries,
      failures,
      heldItems,
    };
  }
}
