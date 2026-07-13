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
        const headers = init?.headers as Record<string, string>;
        expect(headers["X-API-Key"]).toBe("test-key");

        return new Response(
          JSON.stringify({
            success: true,
            items: [{ example: "payload" }, { example: "payload-2" }],
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
    expect(page.items).toHaveLength(2);

    for (const item of page.items) {
      expect(item.source).toBe("pitpanda");
      expect(item.searchQuery).toBe("exact_nonce:abc-123");
      expect(item.retrievedAt).toBeInstanceOf(Date);
      expect(item.observedAt).toBeNull();
      expect(item.rawPayload).toEqual({ example: expect.any(String) });
      expect(item.providerItemKey).toMatch(/^page0:idx\d+:[a-f0-9]{16}$/);
    }
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
