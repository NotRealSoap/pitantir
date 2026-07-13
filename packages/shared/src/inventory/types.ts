export type InventoryFetchErrorCode =
  | "account_not_found"
  | "upstream_unavailable"
  | "upstream_unauthorized"
  | "upstream_rate_limited"
  | "invalid_response"
  | "timeout"
  | "unknown";

export interface InventoryAccountRef {
  id: string;
  mcUsername: string;
  mcUuid: string | null;
}

export interface InventoryFetchSuccess {
  ok: true;
  /** Logical inventory truth time. */
  observedAt: Date;
  /** Opaque raw payload persisted on success. */
  rawInventory: Record<string, unknown>;
}

export interface InventoryFetchFailure {
  ok: false;
  errorCode: InventoryFetchErrorCode;
  errorMessage: string;
}

export type InventoryFetchResult = InventoryFetchSuccess | InventoryFetchFailure;

/**
 * Port for fetching a managed account's Minecraft inventory.
 * Implemented by mock (tests/local) and future live adapters.
 */
export interface InventorySource {
  readonly id: string;
  fetchInventory(account: InventoryAccountRef): Promise<InventoryFetchResult>;
}

export interface ExtractedBookSlot {
  slotKey: string;
  rawItem: Record<string, unknown>;
}
