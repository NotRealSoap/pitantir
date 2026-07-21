import type {
  InventoryAccountRef,
  InventoryFetchResult,
  InventorySource,
} from "./types.js";

export interface MockInventoryFixture {
  /** Match by account id and/or username (case-insensitive). */
  accountId?: string;
  mcUsername?: string;
  result: InventoryFetchResult;
}

/**
 * Deterministic inventory source for tests and local worker runs.
 * Unknown accounts receive a synthetic book inventory (success) unless configured otherwise.
 */
export class MockInventorySource implements InventorySource {
  readonly id = "mock";

  constructor(
    private readonly fixtures: MockInventoryFixture[] = [],
    private readonly options?: { defaultFailure?: boolean },
  ) {}

  async fetchInventory(account: InventoryAccountRef): Promise<InventoryFetchResult> {
    const match = this.fixtures.find((fixture) => {
      if (fixture.accountId && fixture.accountId === account.id) return true;
      if (
        fixture.mcUsername &&
        fixture.mcUsername.toLowerCase() === account.mcUsername.toLowerCase()
      ) {
        return true;
      }
      return false;
    });
    if (match) {
      return cloneResult(match.result);
    }

    if (this.options?.defaultFailure) {
      return {
        ok: false,
        errorCode: "upstream_unavailable",
        errorMessage: "Mock inventory source default failure",
      };
    }

    return cloneResult(defaultSuccessForAccount(account));
  }
}

export function defaultSuccessForAccount(account: InventoryAccountRef): InventoryFetchResult {
  const observedAt = new Date();
  return {
    ok: true,
    observedAt,
    rawInventory: {
      source: "mock",
      accountId: account.id,
      mcUsername: account.mcUsername,
      inventory: [
        {
          slot: 0,
          id: "minecraft:written_book",
          title: `Mock Book for ${account.mcUsername}`,
          author: account.mcUsername,
          pages: [`Hello from mock scan of ${account.mcUsername}`],
          nonce: `mock-nonce-${account.id.slice(0, 8)}`,
          generation: "ORIGINAL",
        },
        {
          slot: 1,
          id: "minecraft:written_book",
          title: "Shared Title",
          author: "Someone",
          pages: ["Clone family sample page"],
          nonce: `mock-shared-${account.mcUsername.toLowerCase()}`,
        },
      ],
      ender_chest: [],
    },
  };
}

function cloneResult(result: InventoryFetchResult): InventoryFetchResult {
  if (!result.ok) {
    return { ...result };
  }
  return {
    ok: true,
    observedAt: new Date(result.observedAt),
    rawInventory: structuredClone(result.rawInventory),
  };
}
