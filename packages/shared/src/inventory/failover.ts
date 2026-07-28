import type { InventoryAccountRef, InventoryFetchResult, InventorySource } from "./types.js";

export interface FailoverInventorySourceOptions {
  primary: InventorySource;
  secondary: InventorySource;
  /**
   * Failure codes that should trigger fallback to the secondary source.
   * Defaults to upstream/network-ish problems rather than domain misses.
   */
  fallbackOn?: Set<string>;
  onDecision?: (info: {
    mode: string;
    activeSource: string;
    activeSince: Date;
    fallbackUsed: boolean;
    detail: string | null;
  }) => Promise<void> | void;
}

/**
 * Try a primary inventory source first, then transparently fall back to a
 * secondary source when the primary is unhealthy (rate limited, unavailable,
 * timed out, etc).
 */
export class FailoverInventorySource implements InventorySource {
  readonly id: string;
  private readonly fallbackOn: Set<string>;

  constructor(private readonly options: FailoverInventorySourceOptions) {
    this.id = `${options.primary.id}+${options.secondary.id}`;
    this.fallbackOn =
      options.fallbackOn ??
      new Set([
        "upstream_unavailable",
        "upstream_rate_limited",
        "upstream_unauthorized",
        "invalid_response",
        "timeout",
        "unknown",
      ]);
  }

  async fetchInventory(account: InventoryAccountRef): Promise<InventoryFetchResult> {
    const first = await this.options.primary.fetchInventory(account);
    if (first.ok) {
      await this.options.onDecision?.({
        mode: this.id,
        activeSource: this.options.primary.id,
        activeSince: new Date(),
        fallbackUsed: false,
        detail: null,
      });
      return first;
    }
    if (!this.fallbackOn.has(first.errorCode)) return first;

    const second = await this.options.secondary.fetchInventory(account);
    if (second.ok) {
      await this.options.onDecision?.({
        mode: this.id,
        activeSource: this.options.secondary.id,
        activeSince: new Date(),
        fallbackUsed: true,
        detail: `${this.options.primary.id}: ${first.errorMessage}`,
      });
      return second;
    }

    return {
      ok: false,
      errorCode: second.errorCode,
      errorMessage: `${this.options.primary.id}: ${first.errorMessage}; ${this.options.secondary.id}: ${second.errorMessage}`,
    };
  }
}
