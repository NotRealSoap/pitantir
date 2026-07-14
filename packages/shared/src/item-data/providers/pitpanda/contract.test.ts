import { describe, expect, it } from "vitest";
import { PitPandaItemDataProvider } from "./adapter.js";
import type { ItemSearchInput } from "../../types.js";

describe("PitPanda provider contract", () => {
  it("normalizes successful upstream items consistently", async () => {
    const provider = new PitPandaItemDataProvider({
      apiKey: "test-key",
      fetchImpl: async (url, init) => {
        expect(String(url)).toContain("https://pitpanda.rocks/api/itemSearch/");
        expect(String(url)).toContain("page=0");
        expect(String(url)).toContain("sort=-lastseen");
        expect(String(url)).toContain("raw=true");
        const headers = init?.headers as Record<string, string>;
        expect(headers["X-API-Key"]).toBe("test-key");

        return new Response(
          JSON.stringify({
            success: true,
            items: [
              { example: "payload" },
              { example: "payload-2" },
              { _id: "651d6219e3a43b157d21b2fe", example: "with-id" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const input: ItemSearchInput = {
      kind: "exact_nonce",
      value: "abc-123",
      page: 0,
    };

    const page = await provider.searchItems(input);
    expect(page.page).toBe(0);
    expect(page.hasNextPage).toBe(true);
    expect(page.items).toHaveLength(3);

    expect(page.items[0]!.providerItemKey).toMatch(/^page0:idx0:[a-f0-9]{16}$/);
    expect(page.items[1]!.providerItemKey).toMatch(/^page0:idx1:[a-f0-9]{16}$/);
    expect(page.items[2]!.providerItemKey).toBe("pp:651d6219e3a43b157d21b2fe");

    for (const item of page.items) {
      expect(item.source).toBe("pitpanda");
      expect(item.searchQuery).toBe("exact_nonce:abc-123");
      expect(item.retrievedAt).toBeInstanceOf(Date);
      expect(item.observedAt).toBeNull();
    }
  });

  it("exposes getItemDetail for ownership timeline payloads", async () => {
    const provider = new PitPandaItemDataProvider({
      apiKey: "test-key",
      fetchImpl: async (url) => {
        expect(String(url)).toContain("/api/item/651d6219e3a43b157d21b2fe");
        return new Response(
          JSON.stringify({
            success: true,
            item: {
              _id: "651d6219e3a43b157d21b2fe",
              owner: "0dee7969122444aea463fdb0fc72d568",
              owners: [
                {
                  _id: "o1",
                  uuid: "610fb96820e740f4b222399a82779e41",
                  time: "2023-10-04T13:01:13.152Z",
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const detail = await provider.getItemDetail("651d6219e3a43b157d21b2fe");
    expect(detail.providerItemKey).toBe("pp:651d6219e3a43b157d21b2fe");
    expect(Array.isArray(detail.rawPayload.owners)).toBe(true);
  });

  it("translates domain search kinds into PitPanda syntax only inside the adapter", async () => {
    const calls: string[] = [];
    const trackingProvider = new PitPandaItemDataProvider({
      apiKey: "test-key",
      fetchImpl: async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ success: true, items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await trackingProvider.searchItems({ kind: "current_owner", value: "Notch", page: 0 });
    await trackingProvider.searchItems({ kind: "past_owner", value: "Notch", page: 1 });

    expect(calls[0]).toContain("uuidNotch");
    expect(calls[1]).toContain("pastNotch");
    expect(calls[0]).not.toContain("current_owner");
  });
});
