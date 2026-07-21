import type { PublicAccount } from "@pitantir/db";
import { ACCOUNT_HISTORY_LIMITS } from "@pitantir/shared/account-history";
import {
  getAccountItemHistory,
  type AccountItemHistoryDeps,
} from "./account-item-history-service";

/** Higher caps for explicit “cache selected accounts” runs. */
export const CACHE_OWNERSHIP_LIMITS = {
  ...ACCOUNT_HISTORY_LIMITS,
  maxUpstreamPages: 15,
  maxItems: 500,
  maxItemHistoryLookups: 200,
  maxUsernameResolutions: 100,
} as const;

export interface CacheOwnershipAccountResult {
  accountId: string;
  mcUsername: string;
  ok: boolean;
  status: string;
  itemsFetched: number;
  ownershipPeriodsHint: number;
  isComplete: boolean;
  message: string | null;
  warnings: string[];
}

export interface CacheOwnershipResult {
  results: CacheOwnershipAccountResult[];
  cachedAccounts: number;
  incompleteAccounts: number;
}

/**
 * For each managed account, pull PitPanda current_owner items and persist owners[].
 * Selection is by managed account id; PitPanda search uses mcUsername.
 */
export async function cachePitPandaOwnershipForAccounts(
  accounts: PublicAccount[],
  deps: AccountItemHistoryDeps,
): Promise<CacheOwnershipResult> {
  const results: CacheOwnershipAccountResult[] = [];
  let cachedAccounts = 0;
  let incompleteAccounts = 0;

  for (const account of accounts) {
    const history = await getAccountItemHistory(
      { ...deps, limits: CACHE_OWNERSHIP_LIMITS },
      {
        account: account.mcUsername,
        page: 0,
        pageSize: 25,
        hideNoPriorOwners: false,
        includeRaw: false,
      },
    );

    const ok = history.status === "ok";
    if (ok) cachedAccounts += 1;
    if (!history.meta.isComplete) incompleteAccounts += 1;

    results.push({
      accountId: account.id,
      mcUsername: account.mcUsername,
      ok,
      status: history.status,
      itemsFetched: history.meta.itemsFetched,
      ownershipPeriodsHint: history.items.reduce(
        (sum, item) => sum + item.ownershipPeriods.length + item.pitpandaOwners.length,
        0,
      ),
      isComplete: history.meta.isComplete,
      message: history.message ?? null,
      warnings: history.meta.warnings,
    });
  }

  return { results, cachedAccounts, incompleteAccounts };
}
