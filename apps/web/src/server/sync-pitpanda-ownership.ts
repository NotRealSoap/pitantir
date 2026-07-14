import {
  ACCOUNT_HISTORY_LIMITS,
  hasEmbeddedOwners,
  parseUpstreamItemFields,
} from "@pitantir/shared/account-history";
import {
  resolveMinecraftProfileByUuid,
  type MinecraftProfile,
} from "@pitantir/shared/inventory";
import type { NormalizedUpstreamItem } from "@pitantir/shared/item-data";
import type { PitPandaOwnershipIngestor } from "@pitantir/db";

export interface OwnershipSyncProvider {
  searchItems(input: {
    kind: "exact_nonce";
    value: string;
    page: number;
  }): Promise<{ items: NormalizedUpstreamItem[]; hasNextPage: boolean }>;
  getItemDetail(itemId: string): Promise<NormalizedUpstreamItem>;
}

export interface SyncPitPandaOwnershipDeps {
  provider: OwnershipSyncProvider;
  ownershipIngestor: PitPandaOwnershipIngestor;
  resolveProfileByUuid?: (
    uuid: string,
    fetchImpl?: typeof fetch,
  ) => Promise<MinecraftProfile>;
  fetchImpl?: typeof fetch;
  /** Pre-known usernames (dashed uuid → name). */
  usernameByUuid?: Map<string, string>;
  /** Soft cap on Mojang lookups for one sync call. */
  maxUsernameResolutions?: number;
}

export interface SyncOwnershipResult {
  attempted: boolean;
  eventsCreated: number;
  periodsCreated: number;
  skippedOwnersWithoutUsername: number;
  message?: string;
}

function normalizeUuidKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const hex = value.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Persist PitPanda owners[] for one already-identified canonical item.
 * Fetches /api/item/{_id} when the payload is missing owners.
 */
export async function syncPitPandaOwnershipFromPayload(
  deps: SyncPitPandaOwnershipDeps,
  input: {
    canonicalItemId: string;
    rawPayload: Record<string, unknown>;
  },
): Promise<SyncOwnershipResult> {
  let payload = input.rawPayload;
  let fields = parseUpstreamItemFields(payload);

  if (!hasEmbeddedOwners(payload) && fields.pitpandaItemId) {
    try {
      const detail = await deps.provider.getItemDetail(fields.pitpandaItemId);
      payload = { ...payload, ...detail.rawPayload };
      fields = parseUpstreamItemFields(payload);
    } catch {
      return {
        attempted: true,
        eventsCreated: 0,
        periodsCreated: 0,
        skippedOwnersWithoutUsername: 0,
        message: "PitPanda item detail lookup failed.",
      };
    }
  }

  if (fields.owners.length === 0) {
    return {
      attempted: true,
      eventsCreated: 0,
      periodsCreated: 0,
      skippedOwnersWithoutUsername: 0,
      message: fields.pitpandaItemId
        ? "PitPanda item detail had no owners[] timeline."
        : "PitPanda search hit had no item id, so owners timeline could not be loaded. Retry after updating.",
    };
  }

  const usernameByUuid = new Map(deps.usernameByUuid ?? []);
  const ownerUuids = new Set<string>();
  for (const owner of fields.owners) {
    const key = normalizeUuidKey(owner.uuid);
    if (key) ownerUuids.add(key);
  }
  if (fields.ownerUuid) {
    const key = normalizeUuidKey(fields.ownerUuid);
    if (key) ownerUuids.add(key);
  }

  const resolveByUuid = deps.resolveProfileByUuid ?? resolveMinecraftProfileByUuid;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const unresolved = [...ownerUuids].filter((uuid) => !usernameByUuid.has(uuid));
  const budget = Math.min(
    unresolved.length,
    deps.maxUsernameResolutions ?? ACCOUNT_HISTORY_LIMITS.maxUsernameResolutions,
  );
  for (let i = 0; i < budget; i += 1) {
    const uuid = unresolved[i]!;
    try {
      const profile = await resolveByUuid(uuid, fetchImpl);
      usernameByUuid.set(normalizeUuidKey(profile.uuid)!, profile.username);
    } catch {
      // leave unresolved — ingestor skips those owners
    }
  }

  const result = await deps.ownershipIngestor.ingest({
    canonicalItemId: input.canonicalItemId,
    pitpandaItemId: fields.pitpandaItemId,
    owners: fields.owners,
    usernameByUuid,
    lastSeenAt: fields.lastSeenAt,
    currentOwnerUuid: fields.ownerUuid,
  });

  return {
    attempted: true,
    eventsCreated: result.eventsCreated,
    periodsCreated: result.periodsCreated,
    skippedOwnersWithoutUsername: result.skippedOwnersWithoutUsername,
  };
}

/**
 * Find the PitPanda document for a nonce and persist its owners onto a canonical item.
 * This is the path PitPal uses implicitly: nonce → PitPanda item → owners[].
 */
export async function syncPitPandaOwnershipByNonce(
  deps: SyncPitPandaOwnershipDeps,
  input: {
    canonicalItemId: string;
    nonce: string;
  },
): Promise<SyncOwnershipResult> {
  const nonce = input.nonce.trim();
  if (!nonce) {
    return {
      attempted: false,
      eventsCreated: 0,
      periodsCreated: 0,
      skippedOwnersWithoutUsername: 0,
      message: "Missing nonce.",
    };
  }

  let page;
  try {
    page = await deps.provider.searchItems({
      kind: "exact_nonce",
      value: nonce,
      page: 0,
    });
  } catch (error) {
    return {
      attempted: true,
      eventsCreated: 0,
      periodsCreated: 0,
      skippedOwnersWithoutUsername: 0,
      message: error instanceof Error ? error.message : "PitPanda nonce search failed.",
    };
  }

  if (page.items.length === 0) {
    return {
      attempted: true,
      eventsCreated: 0,
      periodsCreated: 0,
      skippedOwnersWithoutUsername: 0,
      message: "PitPanda has no indexed item for this nonce.",
    };
  }

  // Prefer the row whose nonce matches exactly; otherwise first hit.
  const match =
    page.items.find((item) => {
      const fields = parseUpstreamItemFields(item.rawPayload);
      return fields.nonce === nonce;
    }) ?? page.items[0]!;

  return syncPitPandaOwnershipFromPayload(deps, {
    canonicalItemId: input.canonicalItemId,
    rawPayload: match.rawPayload,
  });
}
