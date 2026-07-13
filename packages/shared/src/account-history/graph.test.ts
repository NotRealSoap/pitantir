import { describe, expect, it } from "vitest";
import { buildItemTimeline, buildOwnershipGraph } from "./graph.js";
import type { AccountHistoryItem } from "./schemas.js";

function sampleItem(overrides: Partial<AccountHistoryItem> = {}): AccountHistoryItem {
  return {
    key: "item-a",
    providerItemKey: "pp:651d6219e3a43b157d21b2fe",
    canonicalItemId: "canon-1",
    title: "Extraordinary Tier III Bow",
    kind: "bow",
    nonce: "2035964664",
    itemUuid: null,
    lives: 20,
    maxLives: 26,
    customEnchants: { telebow: 3 },
    lore: null,
    lastSeenAt: "2024-02-06T02:17:10.522Z",
    currentOwnerUsername: "Current",
    currentOwnerUuid: "0dee7969-1224-44ae-a463-fdb0fc72d568",
    source: "pitpanda",
    resolutionStatus: "auto_resolved",
    hasLocalHistory: true,
    priorOwnerCount: 2,
    pitpandaOwners: [
      {
        uuid: "610fb968-20e7-40f4-b222-399a82779e41",
        username: "Alice",
        seenAt: "2023-10-04T13:01:13.152Z",
        recordId: "r1",
      },
      {
        uuid: "0dee7969-1224-44ae-a463-fdb0fc72d568",
        username: "Current",
        seenAt: "2024-01-30T22:46:58.293Z",
        recordId: "r2",
      },
    ],
    ownershipPeriods: [
      {
        periodId: "p1",
        accountId: "acc-alice",
        accountUsername: "Alice",
        accountUuid: "610fb968-20e7-40f4-b222-399a82779e41",
        startedAt: "2023-10-04T13:01:13.152Z",
        endedAt: "2024-01-30T22:46:58.293Z",
        certainty: "confirmed",
        isUnknownGap: false,
        startReason: "presence",
        endReason: "move",
      },
    ],
    ownershipEvents: [
      {
        eventId: "e1",
        eventType: "confirmed_move",
        label: "Confirmed move",
        eventTime: "2024-01-30T22:46:58.293Z",
        certainty: "confirmed",
        fromAccountId: "acc-alice",
        fromAccountUsername: "Alice",
        toAccountId: "acc-current",
        toAccountUsername: "Current",
      },
    ],
    historySource: "mixed",
    pitpandaItemId: "651d6219e3a43b157d21b2fe",
    ...overrides,
  };
}

describe("buildOwnershipGraph", () => {
  it("builds bipartite account↔item graph and focuses selected item", () => {
    const other = sampleItem({
      key: "item-b",
      pitpandaItemId: "other",
      canonicalItemId: "canon-2",
      title: "Other bow",
      pitpandaOwners: [],
      ownershipPeriods: [],
      ownershipEvents: [],
      historySource: "none",
      priorOwnerCount: 0,
    });

    const all = buildOwnershipGraph({
      searchedUsername: "Current",
      searchedUuid: "0dee7969-1224-44ae-a463-fdb0fc72d568",
      items: [sampleItem(), other],
    });
    expect(all.nodes.some((n) => n.emphasized && n.kind === "account")).toBe(true);
    expect(all.nodes.some((n) => n.kind === "item" && n.label.includes("Extraordinary"))).toBe(true);
    expect(all.links.length).toBeGreaterThan(0);

    const focused = buildOwnershipGraph({
      searchedUsername: "Current",
      searchedUuid: "0dee7969-1224-44ae-a463-fdb0fc72d568",
      items: [sampleItem(), other],
      selectedItemKey: "item-a",
    });
    expect(focused.nodes.filter((n) => n.kind === "item")).toHaveLength(1);
    expect(focused.nodes.find((n) => n.kind === "item")?.id).toContain("canon-1");
  });

  it("respects minCertainty for local period edges", () => {
    const graph = buildOwnershipGraph({
      searchedUsername: "Current",
      searchedUuid: "0dee7969-1224-44ae-a463-fdb0fc72d568",
      items: [
        sampleItem({
          ownershipPeriods: [
            {
              periodId: "p-unc",
              accountId: "acc",
              accountUsername: "Bob",
              accountUuid: "11111111-1111-1111-1111-111111111111",
              startedAt: "2023-01-01T00:00:00.000Z",
              endedAt: null,
              certainty: "uncertain",
              isUnknownGap: false,
              startReason: null,
              endReason: null,
            },
          ],
        }),
      ],
      minCertainty: "confirmed",
    });
    expect(graph.links.some((l) => l.certainty === "uncertain")).toBe(false);
    expect(graph.links.some((l) => l.id.includes(":local:"))).toBe(false);
    expect(graph.links.some((l) => l.certainty === "pitpanda")).toBe(false);
  });
});

describe("buildItemTimeline", () => {
  it("merges local and PitPanda events chronologically", () => {
    const timeline = buildItemTimeline([sampleItem()]);
    expect(timeline.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < timeline.length; i += 1) {
      expect(timeline[i]!.eventTime >= timeline[i - 1]!.eventTime).toBe(true);
    }
  });
});
