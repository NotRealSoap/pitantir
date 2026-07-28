import { describe, expect, it } from "vitest";
import { PitPandaPlayerInventorySource } from "./pitpanda-player.js";

describe("PitPandaPlayerInventorySource", () => {
  it("maps PitPanda player inventories into Pitantir raw inventory shape", async () => {
    const source = new PitPandaPlayerInventorySource({
      apiKey: "pitpanda-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              uuid: "abc123",
              name: "TraderGuy",
              online: true,
              lastSave: 1_700_000_000,
              inventories: {
                main: [
                  {
                    name: "§cMoctezuma",
                    id: 276,
                    count: 1,
                    nonce: 12345,
                    desc: ["§7Lives: 10/10", "§9Moctezuma 3"],
                    mysticEnchants: [{ key: "moctezuma", tier: 3 }],
                  },
                ],
                enderchest: [{ name: "§fChunk of Vile", id: 263, count: 12 }],
                stash: [{ name: "§aTotally Legit Gem", id: 388, count: 5 }],
                mysticWellItem: [],
                mysticWellPants: [],
                armor: [],
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    });

    const result = await source.fetchInventory({
      id: "acc-1",
      mcUsername: "TraderGuy",
      mcUuid: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.presence?.online).toBe(true);
    expect(result.observedAt.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(result.rawInventory.inventory).toEqual([
      {
        slot: 0,
        id: "276",
        type: "276",
        count: 1,
        title: "Moctezuma",
        lore: ["Lives: 10/10", "Moctezuma 3"],
        nonce: "12345",
        customEnchants: { moctezuma: 3 },
      },
    ]);
    expect(result.rawInventory.ender_chest).toEqual([
      {
        slot: 0,
        id: "263",
        type: "263",
        count: 12,
        title: "Chunk of Vile",
        lore: undefined,
        nonce: undefined,
        customEnchants: undefined,
      },
    ]);
  });

  it("returns unauthorized for invalid keys", async () => {
    const source = new PitPandaPlayerInventorySource({
      apiKey: "bad",
      fetchImpl: async () => new Response('{"success":false,"error":"Invalid key"}', { status: 401 }),
    });
    const result = await source.fetchInventory({
      id: "acc-1",
      mcUsername: "TraderGuy",
      mcUuid: null,
    });
    expect(result).toEqual({
      ok: false,
      errorCode: "upstream_unauthorized",
      errorMessage: "PitPanda rejected the API key.",
    });
  });
});
