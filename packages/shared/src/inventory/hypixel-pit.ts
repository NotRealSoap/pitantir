import type {
  InventoryAccountRef,
  InventoryFetchResult,
  InventorySource,
} from "./types.js";
import { MojangLookupError, formatUndashedUuid, resolveMinecraftProfileByUsername, resolveMinecraftUuid } from "./mojang.js";
import {
  bookFieldsFromNbtItem,
  decodePitInventoryPayload,
  type DecodedInventoryItem,
} from "./pit-nbt.js";
import {
  buildHypixelRateLimitSnapshot,
  parseHypixelRateLimitHeaders,
  type HypixelRateLimitSnapshot,
} from "./hypixel-rate-limit.js";
import {
  presenceFromPlayerLoginLogout,
  presenceFromStatusResponse,
  type HypixelPresence,
} from "./hypixel-presence.js";

export interface HypixelPitInventorySourceOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  resolveUuid?: typeof resolveMinecraftUuid;
  resolveProfile?: typeof resolveMinecraftProfileByUsername;
  /**
   * Called whenever Mojang/Hypixel identity is confirmed so the caller can persist
   * the correct UUID and in-game username casing.
   */
  onIdentityResolved?: (
    accountId: string,
    identity: { mcUuid: string; mcUsername: string },
  ) => Promise<void> | void;
  /** @deprecated Prefer onIdentityResolved */
  onUuidResolved?: (accountId: string, mcUuid: string) => Promise<void> | void;
  /** Called when Hypixel returns RateLimit-* headers so callers can surface quota usage. */
  onRateLimitObserved?: (snapshot: HypixelRateLimitSnapshot) => Promise<void> | void;
  /** Previous window estimate used to refine snapshot.windowSeconds. */
  getPreviousWindowSeconds?: () => Promise<number | null> | number | null;
  /**
   * When true, also call /v2/status (extra API request) for a more accurate online
   * check + current game. Prefer leaving false on large watch lists.
   */
  fetchOnlineStatus?: boolean;
  /** Fired for every Hypixel HTTP call so the UI can show a real-time call feed. */
  onApiCall?: (call: {
    endpoint: string;
    accountId?: string | null;
    mcUsername?: string | null;
    ok: boolean;
    statusCode: number;
    detail?: string | null;
  }) => Promise<void> | void;
}

interface HypixelPlayerResponse {
  success?: boolean;
  cause?: string;
  player?: null | {
    uuid?: string;
    displayname?: string;
    lastLogin?: number;
    lastLogout?: number;
    settings?: { apiSession?: boolean } | null;
    stats?: {
      Pit?: {
        profile?: Record<string, unknown>;
      };
    };
  };
}

/**
 * Fetches Hypixel Pit inventories via `/v2/player` and maps books into Pitantir's raw inventory shape.
 */
export class HypixelPitInventorySource implements InventorySource {
  readonly id = "hypixel_pit";
  private readonly fetchImpl: typeof fetch;
  private readonly resolveUuid: typeof resolveMinecraftUuid;
  private readonly resolveProfile: typeof resolveMinecraftProfileByUsername;

  constructor(private readonly options: HypixelPitInventorySourceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveUuid = options.resolveUuid ?? resolveMinecraftUuid;
    this.resolveProfile = options.resolveProfile ?? resolveMinecraftProfileByUsername;
  }

  async fetchInventory(account: InventoryAccountRef): Promise<InventoryFetchResult> {
    try {
      const identity = await this.resolveIdentity(account);
      const player = await this.fetchPlayer(identity.uuid, account);
      if (!player) {
        return {
          ok: false,
          errorCode: "account_not_found",
          errorMessage: `Hypixel has no player data for ${account.mcUsername}`,
        };
      }

      const profile = player.stats?.Pit?.profile;
      if (!profile) {
        return {
          ok: false,
          errorCode: "invalid_response",
          errorMessage: `No Pit profile for ${account.mcUsername} (player may never have played Pit)`,
        };
      }

      // Prefer Hypixel displayname for in-game casing; fall back to Mojang profile name.
      const displaynameRaw =
        typeof player.displayname === "string" && player.displayname.trim()
          ? player.displayname.trim()
          : identity.username;
      const displayname = /^[A-Za-z0-9_]{3,16}$/.test(displaynameRaw)
        ? displaynameRaw
        : identity.username;

      // Hypixel player.uuid is typically undashed; normalize when present.
      let uuid = identity.uuid;
      if (typeof player.uuid === "string" && player.uuid.trim()) {
        try {
          uuid = formatUndashedUuid(player.uuid.replace(/-/g, ""));
        } catch {
          uuid = identity.uuid;
        }
      }

      await this.persistIdentity(account.id, { mcUuid: uuid, mcUsername: displayname });

      const inventory = await decodeBooksFromPayload(profile.inv_contents);
      const ender_chest = await decodeBooksFromPayload(
        profile.inv_enderchest ?? profile.ender_chest ?? profile.inv_ender_chest,
      );

      const stash = await decodeBooksFromPayload(profile.item_stash);
      const armor = await decodeBooksFromPayload(profile.inv_armor);
      const mysticWell = await decodeBooksFromPayload(profile.mystic_well_item);
      const mysticWellPants = await decodeBooksFromPayload(profile.mystic_well_pants);
      const containers: Array<{ name: string; slots: Array<Record<string, unknown> & { slot: number }> }> =
        [];
      if (armor.length > 0) containers.push({ name: "armor", slots: armor });
      if (stash.length > 0) containers.push({ name: "stash", slots: stash });
      if (mysticWell.length > 0) containers.push({ name: "mystic_well", slots: mysticWell });
      if (mysticWellPants.length > 0) {
        containers.push({ name: "mystic_well_pants", slots: mysticWellPants });
      }

      const containersPresent = {
        inv_contents: Boolean(profile.inv_contents),
        inv_enderchest: Boolean(
          profile.inv_enderchest ?? profile.ender_chest ?? profile.inv_ender_chest,
        ),
        inv_armor: Boolean(profile.inv_armor),
        item_stash: Boolean(profile.item_stash),
        mystic_well_item: Boolean(profile.mystic_well_item),
        mystic_well_pants: Boolean(profile.mystic_well_pants),
      };

      let presence: HypixelPresence = presenceFromPlayerLoginLogout(player);
      if (this.options.fetchOnlineStatus) {
        presence = await this.fetchStatusPresence(uuid, presence, account);
      }

      return {
        ok: true,
        observedAt: new Date(),
        presence,
        rawInventory: {
          source: "hypixel_pit",
          uuid,
          displayname,
          inventory,
          ender_chest,
          ...(containers.length > 0 ? { containers } : {}),
          containersPresent,
        },
      };
    } catch (error: unknown) {
      return mapFetchError(error);
    }
  }

  /**
   * Always resolve UUID from the watch-list username via Mojang.
   * Never trust a previously stored UUID alone — a wrong UUID scans the wrong player.
   */
  private async resolveIdentity(
    account: InventoryAccountRef,
  ): Promise<{ uuid: string; username: string }> {
    // Tests may stub resolveUuid without providing resolveProfile.
    if (this.options.resolveUuid && !this.options.resolveProfile) {
      const uuid = await this.resolveUuid(account.mcUsername, this.fetchImpl);
      return { uuid, username: account.mcUsername };
    }
    const profile = await this.resolveProfile(account.mcUsername, this.fetchImpl);
    return { uuid: profile.uuid, username: profile.username };
  }

  private async persistIdentity(
    accountId: string,
    identity: { mcUuid: string; mcUsername: string },
  ): Promise<void> {
    if (this.options.onIdentityResolved) {
      await this.options.onIdentityResolved(accountId, identity);
      return;
    }
    if (this.options.onUuidResolved) {
      await this.options.onUuidResolved(accountId, identity.mcUuid);
    }
  }

  private async noteRateLimit(headers: Headers): Promise<void> {
    if (!this.options.onRateLimitObserved) return;
    const parsed = parseHypixelRateLimitHeaders(headers);
    if (!parsed) return;
    const previous =
      typeof this.options.getPreviousWindowSeconds === "function"
        ? await this.options.getPreviousWindowSeconds()
        : (this.options.getPreviousWindowSeconds ?? null);
    const snapshot = buildHypixelRateLimitSnapshot(parsed, {
      source: "scan",
      previousWindowSeconds: previous,
    });
    await this.options.onRateLimitObserved(snapshot);
  }

  private async noteApiCall(call: {
    endpoint: string;
    account?: InventoryAccountRef | null;
    ok: boolean;
    statusCode: number;
    detail?: string | null;
  }): Promise<void> {
    if (!this.options.onApiCall) return;
    await this.options.onApiCall({
      endpoint: call.endpoint,
      accountId: call.account?.id ?? null,
      mcUsername: call.account?.mcUsername ?? null,
      ok: call.ok,
      statusCode: call.statusCode,
      detail: call.detail ?? null,
    });
  }

  private async fetchPlayer(
    uuid: string,
    account?: InventoryAccountRef,
  ): Promise<HypixelPlayerResponse["player"]> {
    const undashed = uuid.replace(/-/g, "").toLowerCase();
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://api.hypixel.net/v2/player?uuid=${encodeURIComponent(undashed)}`,
        {
          headers: {
            "API-Key": this.options.apiKey,
            Accept: "application/json",
          },
        },
      );
    } catch (error) {
      await this.noteApiCall({
        endpoint: "player",
        account,
        ok: false,
        statusCode: 0,
        detail: error instanceof Error ? error.message.slice(0, 120) : "network error",
      }).catch(() => undefined);
      throw Object.assign(
        new Error(error instanceof Error ? error.message : "Hypixel network error"),
        { code: "upstream_unavailable" },
      );
    }

    await this.noteRateLimit(response.headers).catch(() => undefined);

    if (response.status === 403) {
      await this.noteApiCall({
        endpoint: "player",
        account,
        ok: false,
        statusCode: 403,
        detail: "unauthorized",
      }).catch(() => undefined);
      throw Object.assign(new Error("Hypixel API key rejected"), { code: "upstream_unauthorized" });
    }
    if (response.status === 429) {
      await this.noteApiCall({
        endpoint: "player",
        account,
        ok: false,
        statusCode: 429,
        detail: "rate limited",
      }).catch(() => undefined);
      throw Object.assign(new Error("Hypixel rate limited"), { code: "upstream_rate_limited" });
    }
    if (!response.ok) {
      await this.noteApiCall({
        endpoint: "player",
        account,
        ok: false,
        statusCode: response.status,
      }).catch(() => undefined);
      throw Object.assign(new Error(`Hypixel HTTP ${response.status}`), {
        code: "upstream_unavailable",
      });
    }

    const body = (await response.json()) as HypixelPlayerResponse;
    if (body.success === false) {
      await this.noteApiCall({
        endpoint: "player",
        account,
        ok: false,
        statusCode: response.status,
        detail: body.cause ?? "request failed",
      }).catch(() => undefined);
      throw Object.assign(new Error(body.cause ?? "Hypixel request failed"), {
        code: "upstream_unavailable",
      });
    }
    await this.noteApiCall({
      endpoint: "player",
      account,
      ok: true,
      statusCode: response.status,
      detail: body.player ? "ok" : "no player",
    }).catch(() => undefined);
    return body.player ?? null;
  }

  private async fetchStatusPresence(
    uuid: string,
    fallback: HypixelPresence,
    account?: InventoryAccountRef,
  ): Promise<HypixelPresence> {
    try {
      const undashed = uuid.replace(/-/g, "").toLowerCase();
      const response = await this.fetchImpl(
        `https://api.hypixel.net/v2/status?uuid=${encodeURIComponent(undashed)}`,
        {
          headers: {
            "API-Key": this.options.apiKey,
            Accept: "application/json",
          },
        },
      );
      await this.noteRateLimit(response.headers).catch(() => undefined);
      await this.noteApiCall({
        endpoint: "status",
        account,
        ok: response.ok,
        statusCode: response.status,
      }).catch(() => undefined);
      if (!response.ok) return fallback;
      const body = (await response.json()) as unknown;
      return presenceFromStatusResponse(body, fallback);
    } catch {
      return fallback;
    }
  }
}

async function decodeBooksFromPayload(
  payload: unknown,
): Promise<Array<Record<string, unknown> & { slot: number }>> {
  const items = await decodePitInventoryPayload(payload);
  return items
    .map((item: DecodedInventoryItem, index: number) => {
      const book = bookFieldsFromNbtItem(item);
      if (!book) return null;
      return { slot: item.slot ?? index, ...book };
    })
    .filter(
      (row: (Record<string, unknown> & { slot: number }) | null): row is Record<
        string,
        unknown
      > & { slot: number } => row !== null,
    );
}

function mapFetchError(error: unknown): InventoryFetchResult {
  if (error instanceof MojangLookupError) {
    if (error.code === "not_found") {
      return { ok: false, errorCode: "account_not_found", errorMessage: error.message };
    }
    return { ok: false, errorCode: "upstream_unavailable", errorMessage: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  const rawCode =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : "unknown";
  const allowed = new Set([
    "account_not_found",
    "upstream_unavailable",
    "upstream_unauthorized",
    "upstream_rate_limited",
    "invalid_response",
    "timeout",
    "unknown",
  ]);
  const errorCode = (allowed.has(rawCode) ? rawCode : "unknown") as
    | "account_not_found"
    | "upstream_unavailable"
    | "upstream_unauthorized"
    | "upstream_rate_limited"
    | "invalid_response"
    | "timeout"
    | "unknown";
  return { ok: false, errorCode, errorMessage: message };
}
