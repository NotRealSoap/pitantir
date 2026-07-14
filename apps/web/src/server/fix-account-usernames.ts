import type { PublicAccount } from "@pitantir/db";
import {
  MojangLookupError,
  resolveMinecraftProfileByUsername,
  resolveMinecraftProfileByUuid,
  type MinecraftProfile,
} from "@pitantir/shared/inventory";

export interface AccountIdentityPatch {
  id: string;
  previousUsername: string;
  mcUsername: string;
  previousUuid: string | null;
  mcUuid: string;
  changed: boolean;
  error?: string;
}

export interface FixAccountUsernamesDeps {
  listAccounts: () => Promise<PublicAccount[]>;
  getAccount?: (id: string) => Promise<PublicAccount | null>;
  updateAccount: (
    id: string,
    patch: { mcUsername?: string; mcUuid?: string | null },
  ) => Promise<PublicAccount>;
  resolveProfileByUsername?: (
    username: string,
    fetchImpl?: typeof fetch,
  ) => Promise<MinecraftProfile>;
  resolveProfileByUuid?: (uuid: string, fetchImpl?: typeof fetch) => Promise<MinecraftProfile>;
  fetchImpl?: typeof fetch;
  /** Delay between Mojang lookups to reduce rate limits (ms). */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface FixAccountUsernamesInput {
  /** When set, only these account ids are fixed. */
  accountIds?: string[];
  /** When true, include ownership contacts; default is watch list only via listAccounts filtering upstream. */
  scope?: "provided" | "all";
}

function sleepDefault(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve canonical Minecraft username casing + UUID via Mojang.
 * Prefer UUID lookup when available (returns correct IGN casing without relying on stored casing).
 */
export async function resolveCanonicalMinecraftIdentity(
  account: Pick<PublicAccount, "mcUsername" | "mcUuid">,
  deps: {
    resolveProfileByUsername: (
      username: string,
      fetchImpl?: typeof fetch,
    ) => Promise<MinecraftProfile>;
    resolveProfileByUuid: (uuid: string, fetchImpl?: typeof fetch) => Promise<MinecraftProfile>;
    fetchImpl?: typeof fetch;
  },
): Promise<MinecraftProfile> {
  if (account.mcUuid) {
    try {
      return await deps.resolveProfileByUuid(account.mcUuid, deps.fetchImpl);
    } catch (error) {
      // UUID miss → try username. Upstream outages should fail the whole fix.
      if (error instanceof MojangLookupError && error.code === "upstream_unavailable") {
        throw error;
      }
    }
  }
  return deps.resolveProfileByUsername(account.mcUsername, deps.fetchImpl);
}

/**
 * Fix stored mcUsername casing (and fill/confirm mcUuid) for a list of accounts via Mojang.
 */
export async function fixAccountUsernames(
  deps: FixAccountUsernamesDeps,
  input: FixAccountUsernamesInput = {},
): Promise<{
  checked: number;
  updated: number;
  unchanged: number;
  failed: number;
  results: AccountIdentityPatch[];
}> {
  const resolveByUsername = deps.resolveProfileByUsername ?? resolveMinecraftProfileByUsername;
  const resolveByUuid = deps.resolveProfileByUuid ?? resolveMinecraftProfileByUuid;
  const sleep = deps.sleep ?? sleepDefault;
  const delayMs = deps.delayMs ?? 120;

  let accounts: PublicAccount[];
  if (input.accountIds && input.accountIds.length > 0) {
    if (!deps.getAccount) {
      throw new Error("getAccount is required when accountIds are provided");
    }
    accounts = [];
    for (const id of input.accountIds) {
      const account = await deps.getAccount(id);
      if (account) accounts.push(account);
    }
  } else {
    accounts = await deps.listAccounts();
  }

  const results: AccountIdentityPatch[] = [];
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i]!;
    if (i > 0 && delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      const profile = await resolveCanonicalMinecraftIdentity(account, {
        resolveProfileByUsername: resolveByUsername,
        resolveProfileByUuid: resolveByUuid,
        fetchImpl: deps.fetchImpl,
      });

      const usernameChanged = profile.username !== account.mcUsername;
      const uuidChanged = profile.uuid !== account.mcUuid;
      if (!usernameChanged && !uuidChanged) {
        unchanged += 1;
        results.push({
          id: account.id,
          previousUsername: account.mcUsername,
          mcUsername: account.mcUsername,
          previousUuid: account.mcUuid,
          mcUuid: account.mcUuid ?? profile.uuid,
          changed: false,
        });
        continue;
      }

      const saved = await deps.updateAccount(account.id, {
        mcUsername: profile.username,
        mcUuid: profile.uuid,
      });
      updated += 1;
      results.push({
        id: account.id,
        previousUsername: account.mcUsername,
        mcUsername: saved.mcUsername,
        previousUuid: account.mcUuid,
        mcUuid: saved.mcUuid ?? profile.uuid,
        changed: true,
      });
    } catch (error) {
      failed += 1;
      results.push({
        id: account.id,
        previousUsername: account.mcUsername,
        mcUsername: account.mcUsername,
        previousUuid: account.mcUuid,
        mcUuid: account.mcUuid ?? "",
        changed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    checked: accounts.length,
    updated,
    unchanged,
    failed,
    results,
  };
}
