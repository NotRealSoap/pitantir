import { describe, expect, it } from "vitest";
import { MemoryIdentityStore } from "../identity/memory-store.js";
import {
  PitPandaOwnershipIngestor,
  type OwnershipAccountRef,
  type OwnershipAccountResolver,
} from "./pitpanda-ownership-ingestor.js";

class FakeAccounts implements OwnershipAccountResolver {
  readonly byUuid = new Map<string, OwnershipAccountRef>();

  async ensureShadowOwner(input: {
    mcUuid: string;
    mcUsername: string;
  }): Promise<OwnershipAccountRef> {
    const existing = this.byUuid.get(input.mcUuid.toLowerCase());
    if (existing) return existing;
    const account = {
      id: `acct-${this.byUuid.size + 1}`,
      mcUsername: input.mcUsername,
      mcUuid: input.mcUuid,
    };
    this.byUuid.set(input.mcUuid.toLowerCase(), account);
    return account;
  }
}

describe("PitPandaOwnershipIngestor", () => {
  it("writes uncertain import periods from consecutive owners and is idempotent", async () => {
    const store = new MemoryIdentityStore();
    const accounts = new FakeAccounts();
    const ingestor = new PitPandaOwnershipIngestor(store, accounts);

    const item = await store.createCanonicalItem({
      displayName: "Test Bow",
      category: "unique_nonce_candidate",
      identityConfidence: "medium",
      primaryNonce: "2035964664",
    });

    const owners = [
      {
        uuid: "610fb968-20e7-40f4-b222-399a82779e41",
        seenAt: "2023-10-04T13:01:13.152Z",
        pitpandaEventId: "rec-1",
      },
      {
        uuid: "0dee7969-1224-44ae-a463-fdb0fc72d568",
        seenAt: "2024-01-30T22:46:58.293Z",
        pitpandaEventId: "rec-2",
      },
    ];

    const usernameByUuid = new Map([
      [owners[0]!.uuid, "Alice"],
      [owners[1]!.uuid, "Bob"],
    ]);

    const first = await ingestor.ingest({
      canonicalItemId: item.id,
      pitpandaItemId: "651d6219e3a43b157d21b2fe",
      owners,
      usernameByUuid,
      currentOwnerUuid: owners[1]!.uuid,
      lastSeenAt: "2024-02-06T02:17:10.522Z",
    });

    expect(first.eventsCreated).toBe(2);
    expect(first.periodsCreated).toBe(2);
    expect(first.accountsLinked).toBe(2);

    const periods = await store.listLocationPeriodsForItem(item.id);
    expect(periods).toHaveLength(2);
    expect(periods.every((p) => p.startReason === "import")).toBe(true);
    expect(periods.every((p) => p.certainty === "uncertain")).toBe(true);

    const earlier = periods.find((p) => p.accountId === "acct-1")!;
    const later = periods.find((p) => p.accountId === "acct-2")!;
    expect(earlier.endedAt?.toISOString()).toBe(owners[1]!.seenAt);
    expect(later.endedAt).toBeNull();

    const events = await store.listLocationEventsForItem(item.id);
    expect(events.every((e) => e.eventType === "import_presence")).toBe(true);

    const second = await ingestor.ingest({
      canonicalItemId: item.id,
      pitpandaItemId: "651d6219e3a43b157d21b2fe",
      owners,
      usernameByUuid,
      currentOwnerUuid: owners[1]!.uuid,
    });
    expect(second.eventsCreated).toBe(0);
    expect(second.periodsCreated).toBe(0);
    expect((await store.listLocationPeriodsForItem(item.id)).length).toBe(2);
  });

  it("skips owners without resolved usernames", async () => {
    const store = new MemoryIdentityStore();
    const accounts = new FakeAccounts();
    const ingestor = new PitPandaOwnershipIngestor(store, accounts);
    const item = await store.createCanonicalItem({
      category: "unknown",
      identityConfidence: "low",
    });

    const result = await ingestor.ingest({
      canonicalItemId: item.id,
      pitpandaItemId: null,
      owners: [
        {
          uuid: "610fb968-20e7-40f4-b222-399a82779e41",
          seenAt: "2023-10-04T13:01:13.152Z",
          pitpandaEventId: "rec-1",
        },
      ],
      usernameByUuid: new Map(),
    });

    expect(result.skippedOwnersWithoutUsername).toBe(1);
    expect(result.periodsCreated).toBe(0);
    expect(await store.listLocationPeriodsForItem(item.id)).toHaveLength(0);
  });

  it("does not invent mid-interval transfer times", async () => {
    const store = new MemoryIdentityStore();
    const accounts = new FakeAccounts();
    const ingestor = new PitPandaOwnershipIngestor(store, accounts);
    const item = await store.createCanonicalItem({
      category: "unique_nonce_candidate",
      identityConfidence: "medium",
    });

    const t1 = "2024-01-01T00:00:00.000Z";
    const t2 = "2024-06-01T00:00:00.000Z";
    await ingestor.ingest({
      canonicalItemId: item.id,
      pitpandaItemId: "abc",
      owners: [
        {
          uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          seenAt: t1,
          pitpandaEventId: "a",
        },
        {
          uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          seenAt: t2,
          pitpandaEventId: "b",
        },
      ],
      usernameByUuid: new Map([
        ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "One"],
        ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Two"],
      ]),
      currentOwnerUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    });

    const periods = await store.listLocationPeriodsForItem(item.id);
    const first = periods.find((p) => p.startedAt.toISOString() === t1)!;
    expect(first.endedAt?.toISOString()).toBe(t2);
  });
});
