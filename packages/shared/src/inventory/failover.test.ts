import { describe, expect, it } from "vitest";
import type { InventorySource } from "./types.js";
import { FailoverInventorySource } from "./failover.js";

describe("FailoverInventorySource", () => {
  it("returns primary success without calling secondary", async () => {
    let secondaryCalled = false;
    const source = new FailoverInventorySource({
      primary: {
        id: "primary",
        fetchInventory: async () => ({
          ok: true,
          observedAt: new Date("2026-01-01T00:00:00.000Z"),
          rawInventory: { inventory: [] },
        }),
      } satisfies InventorySource,
      secondary: {
        id: "secondary",
        fetchInventory: async () => {
          secondaryCalled = true;
          return {
            ok: true,
            observedAt: new Date("2026-01-02T00:00:00.000Z"),
            rawInventory: { inventory: [] },
          };
        },
      } satisfies InventorySource,
    });

    const result = await source.fetchInventory({
      id: "a",
      mcUsername: "User",
      mcUuid: null,
    });
    expect(result.ok).toBe(true);
    expect(secondaryCalled).toBe(false);
  });

  it("falls back on rate limits and returns secondary success", async () => {
    const source = new FailoverInventorySource({
      primary: {
        id: "hypixel",
        fetchInventory: async () => ({
          ok: false,
          errorCode: "upstream_rate_limited",
          errorMessage: "429",
        }),
      } satisfies InventorySource,
      secondary: {
        id: "pitpanda",
        fetchInventory: async () => ({
          ok: true,
          observedAt: new Date("2026-01-02T00:00:00.000Z"),
          rawInventory: { inventory: [{ id: "276" }] },
        }),
      } satisfies InventorySource,
    });

    const result = await source.fetchInventory({
      id: "a",
      mcUsername: "User",
      mcUuid: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rawInventory.inventory).toHaveLength(1);
  });
});
