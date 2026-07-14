import { describe, expect, it, vi } from "vitest";
import type { PublicAccount } from "@pitantir/db";
import { cachePitPandaOwnershipForAccounts } from "./cache-account-ownership";
import type { AccountHistoryProvider } from "./account-item-history-service";

function fakeAccount(overrides: Partial<PublicAccount> = {}): PublicAccount {
  return {
    id: "acc-1",
    mcUsername: "Steve",
    mcUuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5",
    displayName: null,
    enabled: true,
    watchlisted: true,
    priority: 100,
    scanIntervalSeconds: 3600,
    nextScanAt: new Date(),
    lastSuccessScanAt: null,
    lastFailureScanAt: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe("cachePitPandaOwnershipForAccounts", () => {
  it("runs history sync for each selected account username", async () => {
    const searchItems = vi.fn(async () => ({
      items: [],
      page: 0,
      hasNextPage: false,
      providerId: "pitpanda" as const,
      retrievedAt: new Date(),
    }));
    const provider: AccountHistoryProvider = {
      searchItems,
      getItemDetail: async () => {
        throw new Error("unused");
      },
    };

    const result = await cachePitPandaOwnershipForAccounts(
      [
        fakeAccount({ id: "a1", mcUsername: "Alice" }),
        fakeAccount({ id: "a2", mcUsername: "Bob", mcUuid: "11111111-1111-4111-8111-111111111111" }),
      ],
      {
        provider,
        enricher: null,
        ownershipIngestor: null,
        resolveProfileByUsername: async (username) => ({
          username,
          uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5",
        }),
      },
    );

    expect(result.results).toHaveLength(2);
    expect(result.results.map((r) => r.mcUsername)).toEqual(["Alice", "Bob"]);
    expect(searchItems).toHaveBeenCalled();
    const firstCall = searchItems.mock.calls.at(0)?.at(0) as
      | { kind?: string; value?: string }
      | undefined;
    expect(firstCall).toMatchObject({
      kind: "current_owner",
      value: "Alice",
    });
  });
});
