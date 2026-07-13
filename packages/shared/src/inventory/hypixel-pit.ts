import type {
  InventoryAccountRef,
  InventoryFetchResult,
  InventorySource,
} from "./types.js";
import { MojangLookupError, resolveMinecraftUuid } from "./mojang.js";
import {
  bookFieldsFromNbtItem,
  decodePitInventoryPayload,
  type DecodedInventoryItem,
} from "./pit-nbt.js";

export interface HypixelPitInventorySourceOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  resolveUuid?: typeof resolveMinecraftUuid;
  /**
   * Called when a username is resolved to a UUID so the caller can persist it.
   */
  onUuidResolved?: (accountId: string, mcUuid: string) => Promise<void> | void;
}

interface HypixelPlayerResponse {
  success?: boolean;
  cause?: string;
  player?: null | {
    uuid?: string;
    displayname?: string;
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

  constructor(private readonly options: HypixelPitInventorySourceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveUuid = options.resolveUuid ?? resolveMinecraftUuid;
  }

  async fetchInventory(account: InventoryAccountRef): Promise<InventoryFetchResult> {
    try {
      const uuid = await this.ensureUuid(account);
      const player = await this.fetchPlayer(uuid);
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

      const inventoryItems = await decodePitInventoryPayload(profile.inv_contents);
      const enderItems = await decodePitInventoryPayload(
        profile.inv_enderchest ?? profile.ender_chest ?? profile.inv_ender_chest,
      );

      const inventory = inventoryItems
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

      const ender_chest = enderItems
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

      return {
        ok: true,
        observedAt: new Date(),
        rawInventory: {
          source: "hypixel_pit",
          uuid,
          displayname: player.displayname ?? account.mcUsername,
          inventory,
          ender_chest,
          // Keep compact provenance without dumping full NBT byte arrays twice.
          containersPresent: {
            inv_contents: Boolean(profile.inv_contents),
            inv_enderchest: Boolean(
              profile.inv_enderchest ?? profile.ender_chest ?? profile.inv_ender_chest,
            ),
          },
        },
      };
    } catch (error: unknown) {
      return mapFetchError(error);
    }
  }

  private async ensureUuid(account: InventoryAccountRef): Promise<string> {
    if (account.mcUuid) {
      return account.mcUuid.replace(/-/g, "").length === 32
        ? account.mcUuid
        : account.mcUuid;
    }
    const uuid = await this.resolveUuid(account.mcUsername, this.fetchImpl);
    if (this.options.onUuidResolved) {
      await this.options.onUuidResolved(account.id, uuid);
    }
    return uuid;
  }

  private async fetchPlayer(uuid: string): Promise<HypixelPlayerResponse["player"]> {
    const undashed = uuid.replace(/-/g, "").toLowerCase();
    const response = await this.fetchImpl(
      `https://api.hypixel.net/v2/player?uuid=${encodeURIComponent(undashed)}`,
      {
        headers: {
          "API-Key": this.options.apiKey,
          Accept: "application/json",
        },
      },
    );

    if (response.status === 403) {
      throw Object.assign(new Error("Hypixel API key rejected"), { code: "upstream_unauthorized" });
    }
    if (response.status === 429) {
      throw Object.assign(new Error("Hypixel rate limited"), { code: "upstream_rate_limited" });
    }
    if (!response.ok) {
      throw Object.assign(new Error(`Hypixel HTTP ${response.status}`), {
        code: "upstream_unavailable",
      });
    }

    const body = (await response.json()) as HypixelPlayerResponse;
    if (body.success === false) {
      throw Object.assign(new Error(body.cause ?? "Hypixel request failed"), {
        code: "upstream_unavailable",
      });
    }
    return body.player ?? null;
  }
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
