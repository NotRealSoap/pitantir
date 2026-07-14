import { describe, expect, it, vi } from "vitest";
import { MemoryIdentityStore } from "@pitantir/db";
import { PitPandaOwnershipIngestor } from "@pitantir/db";
import {
  syncPitPandaOwnershipByNonce,
  syncPitPandaOwnershipFromPayload,
} from "./sync-pitpanda-ownership";

describe("syncPitPandaOwnership", () => {
  it("persists owners from an embedded detail payload", async () => {
    const store = new MemoryIdentityStore();
    const item = await store.createCanonicalItem({
      primaryNonce: "2042600219",
      category: "unique_nonce_candidate",
    });
    const accounts = {
      ensureShadowOwner: vi.fn(async (input: { mcUuid: string; mcUsername: string }) => ({
        id: `id-${input.mcUsername}`,
        mcUsername: input.mcUsername,
        mcUuid: input.mcUuid,
      })),
    };
    const ownershipIngestor = new PitPandaOwnershipIngestor(store, accounts);

    const result = await syncPitPandaOwnershipFromPayload(
      {
        provider: {
          searchItems: async () => ({ items: [], hasNextPage: false }),
          getItemDetail: async () => {
            throw new Error("should not fetch detail when owners embedded");
          },
        },
        ownershipIngestor,
        resolveProfileByUuid: async (uuid) => ({
          uuid,
          username: uuid.startsWith("610f") ? "first" : "second",
        }),
      },
      {
        canonicalItemId: item.id,
        rawPayload: {
          _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
          owner: "0dee7969122444aea463fdb0fc72d568",
          nonce: 2042600219,
          owners: [
            {
              _id: "o1",
              uuid: "610fb96820e740f4b222399a82779e41",
              time: "2024-06-08T00:00:00.000Z",
            },
            {
              _id: "o2",
              uuid: "0dee7969122444aea463fdb0fc72d568",
              time: "2024-07-16T00:00:00.000Z",
            },
          ],
        },
      },
    );

    expect(result.eventsCreated).toBe(2);
    expect(result.periodsCreated).toBe(2);
    expect(await store.listLocationEventsForItem(item.id)).toHaveLength(2);
  });

  it("looks up PitPanda by nonce when syncing a local item", async () => {
    const store = new MemoryIdentityStore();
    const item = await store.createCanonicalItem({
      primaryNonce: "2042600219",
    });
    const ownershipIngestor = new PitPandaOwnershipIngestor(store, {
      ensureShadowOwner: async (input) => ({
        id: `id-${input.mcUsername}`,
        mcUsername: input.mcUsername,
        mcUuid: input.mcUuid,
      }),
    });

    const result = await syncPitPandaOwnershipByNonce(
      {
        provider: {
          searchItems: async () => ({
            items: [
              {
                source: "pitpanda",
                providerItemKey: "pp:bbbbbbbbbbbbbbbbbbbbbbbb",
                observedAt: null,
                retrievedAt: new Date(),
                searchQuery: "exact_nonce:2042600219",
                rawPayload: {
                  _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
                  nonce: 2042600219,
                  // owners omitted → detail fetch
                },
              },
            ],
            hasNextPage: false,
          }),
          getItemDetail: async () => ({
            source: "pitpanda",
            providerItemKey: "pp:bbbbbbbbbbbbbbbbbbbbbbbb",
            observedAt: null,
            retrievedAt: new Date(),
            searchQuery: "item:bbbbbbbbbbbbbbbbbbbbbbbb",
            rawPayload: {
              _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
              nonce: 2042600219,
              owner: "0dee7969122444aea463fdb0fc72d568",
              owners: [
                {
                  _id: "o1",
                  uuid: "610fb96820e740f4b222399a82779e41",
                  time: "2024-06-08T00:00:00.000Z",
                },
                {
                  _id: "o2",
                  uuid: "0dee7969122444aea463fdb0fc72d568",
                  time: "2024-07-16T00:00:00.000Z",
                },
              ],
            },
          }),
        },
        ownershipIngestor,
        resolveProfileByUuid: async (uuid) => ({
          uuid,
          username: uuid.startsWith("610f") ? "oMej" : "hollee",
        }),
      },
      { canonicalItemId: item.id, nonce: "2042600219" },
    );

    expect(result.eventsCreated).toBe(2);
    const events = await store.listLocationEventsForItem(item.id);
    expect(events.every((e) => e.eventType === "import_presence")).toBe(true);
  });
});
