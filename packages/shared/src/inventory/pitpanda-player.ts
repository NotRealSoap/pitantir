import type {
  InventoryAccountRef,
  InventoryFetchResult,
  InventorySource,
} from "./types.js";
import { stripMcFormatting } from "./mc-text.js";
import { coerceInventoryNonce } from "./nonce.js";

export interface PitPandaPlayerInventorySourceOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type PitPandaPlayersResponse = {
  success?: boolean;
  error?: string;
  data?: {
    uuid?: string;
    name?: string;
    online?: boolean | null;
    lastSave?: number | null;
    lastLogout?: number | null;
    inventories?: Record<string, unknown[]>;
  };
};

const DEFAULT_BASE_URL = "https://pitpanda.rocks/api";

/**
 * Uses PitPanda's keyed `/api/players/:tag` endpoint, which returns decoded Pit
 * bags (main / enderchest / stash / mystic well / armor) from PitPanda's own
 * Hypixel-backed player fetch.
 */
export class PitPandaPlayerInventorySource implements InventorySource {
  readonly id = "pitpanda_player";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: PitPandaPlayerInventorySourceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchInventory(account: InventoryAccountRef): Promise<InventoryFetchResult> {
    const tag = account.mcUuid?.replace(/-/g, "") || account.mcUsername;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 20_000);

    try {
      const response = await this.fetchImpl(
        `${this.options.baseUrl ?? DEFAULT_BASE_URL}/players/${encodeURIComponent(tag)}`,
        {
          headers: {
            Accept: "application/json",
            "X-API-Key": this.options.apiKey,
          },
          signal: controller.signal,
        },
      );

      if (response.status === 401) {
        return {
          ok: false,
          errorCode: "upstream_unauthorized",
          errorMessage: "PitPanda rejected the API key.",
        };
      }
      if (response.status === 429) {
        return {
          ok: false,
          errorCode: "upstream_rate_limited",
          errorMessage: "PitPanda rate limited the player inventory endpoint.",
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          errorCode: "upstream_unavailable",
          errorMessage: `PitPanda HTTP ${response.status}`,
        };
      }

      const body = (await response.json()) as PitPandaPlayersResponse;
      if (!body.success || !body.data) {
        const message = typeof body.error === "string" ? body.error : "PitPanda player lookup failed";
        return {
          ok: false,
          errorCode: /not found/i.test(message) ? "account_not_found" : "invalid_response",
          errorMessage: message,
        };
      }

      const inventories =
        body.data.inventories && typeof body.data.inventories === "object"
          ? body.data.inventories
          : {};

      const rawInventory = {
        source: "pitpanda_player",
        provider: "pitpanda",
        mcUsername: body.data.name ?? account.mcUsername,
        mcUuid: body.data.uuid ?? account.mcUuid ?? undefined,
        inventory: normalizeSlots(inventories.main),
        ender_chest: normalizeSlots(inventories.enderchest),
        containers: [
          { name: "stash", slots: normalizeSlots(inventories.stash) },
          { name: "mystic_well_item", slots: normalizeSlots(inventories.mysticWellItem) },
          { name: "mystic_well_pants", slots: normalizeSlots(inventories.mysticWellPants) },
          { name: "armor", slots: normalizeSlots(inventories.armor) },
        ],
      };

      return {
        ok: true,
        observedAt: observedAtFromPitPanda(body.data),
        rawInventory,
        presence: {
          online: typeof body.data.online === "boolean" ? body.data.online : null,
          source: "unknown",
          lastLoginAt: null,
          lastLogoutAt:
            typeof body.data.lastLogout === "number" && Number.isFinite(body.data.lastLogout)
              ? new Date(body.data.lastLogout).toISOString()
              : null,
          gameType: null,
          mode: null,
          map: null,
          sessionHidden: false,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { ok: false, errorCode: "timeout", errorMessage: "PitPanda request timed out." };
      }
      return {
        ok: false,
        errorCode: "upstream_unavailable",
        errorMessage: error instanceof Error ? error.message : "PitPanda request failed.",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function observedAtFromPitPanda(data: NonNullable<PitPandaPlayersResponse["data"]>): Date {
  if (typeof data.lastSave === "number" && Number.isFinite(data.lastSave) && data.lastSave > 0) {
    // PitPanda stores `lastSave` as Unix seconds from Hypixel.
    return new Date(data.lastSave * 1000);
  }
  return new Date();
}

function normalizeSlots(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => normalizeItem(entry, index)).filter(Boolean) as Array<
    Record<string, unknown>
  >;
}

function normalizeItem(entry: unknown, index: number): Record<string, unknown> | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const row = entry as Record<string, unknown>;
  const id =
    typeof row.id === "number"
      ? String(Math.trunc(row.id))
      : typeof row.id === "string"
        ? row.id
        : null;
  const count =
    typeof row.count === "number" && Number.isFinite(row.count)
      ? Math.max(0, Math.trunc(row.count))
      : 1;
  const title = typeof row.name === "string" ? stripMcFormatting(row.name) ?? row.name : undefined;
  const lore = Array.isArray(row.desc)
    ? row.desc
        .filter((line): line is string => typeof line === "string")
        .map((line) => stripMcFormatting(line) ?? line)
    : undefined;
  const customEnchants = Array.isArray(row.mysticEnchants)
    ? Object.fromEntries(
        row.mysticEnchants
          .filter(
            (ench): ench is { key?: unknown; tier?: unknown } =>
              Boolean(ench && typeof ench === "object" && !Array.isArray(ench)),
          )
          .map((ench) => [
            String(ench.key ?? "").trim(),
            Number.isFinite(Number(ench.tier)) ? Math.trunc(Number(ench.tier)) : 0,
          ])
          .filter(([key, tier]) => key.length > 0 && tier > 0),
      )
    : undefined;

  return {
    slot: index,
    id: id ?? undefined,
    type: id ?? undefined,
    count,
    title,
    lore,
    nonce: coerceInventoryNonce(row.nonce) ?? undefined,
    customEnchants:
      customEnchants && Object.keys(customEnchants).length > 0 ? customEnchants : undefined,
  };
}
