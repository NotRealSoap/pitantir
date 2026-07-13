import { describe, expect, it } from "vitest";
import { extractBookSlots } from "./extract.js";
import { MockInventorySource, defaultSuccessForAccount } from "./mock.js";

describe("inventory extraction + mock source", () => {
  it("mock returns fixture inventories", async () => {
    const source = new MockInventorySource([
      {
        mcUsername: "Alice",
        result: {
          ok: true,
          observedAt: new Date("2026-01-01T00:00:00.000Z"),
          rawInventory: {
            inventory: [{ slot: 3, title: "A", author: "B", nonce: "n1", pages: "p" }],
          },
        },
      },
      {
        accountId: "fail-id",
        result: {
          ok: false,
          errorCode: "upstream_unavailable",
          errorMessage: "boom",
        },
      },
    ]);

    const ok = await source.fetchInventory({
      id: "other",
      mcUsername: "Alice",
      mcUuid: null,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.rawInventory.inventory).toHaveLength(1);
    }

    const fail = await source.fetchInventory({
      id: "fail-id",
      mcUsername: "Bob",
      mcUuid: null,
    });
    expect(fail.ok).toBe(false);
  });

  it("extracts book slots with stable keys", () => {
    const slots = extractBookSlots({
      inventory: [
        { slot: 0, title: "One", author: "A", nonce: "n1", pages: ["a"] },
        { slot: 1, id: "minecraft:diamond", count: 1 },
        { slot: 2, item: { title: "Nested", author: "B", pages: "x" } },
      ],
      ender_chest: [{ slot: 0, title: "E", author: "C", nonce: "ne" }],
    });

    expect(slots.map((s) => s.slotKey)).toEqual(["echest:0", "inv:0", "inv:2"]);
    expect(slots[1]?.rawItem).toMatchObject({ title: "One", nonce: "n1" });
  });

  it("default mock success includes books for unknown accounts", async () => {
    const source = new MockInventorySource();
    const result = await source.fetchInventory({
      id: "00000000-0000-4000-8000-000000000099",
      mcUsername: "Tester",
      mcUuid: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const slots = extractBookSlots(result.rawInventory);
      expect(slots.length).toBeGreaterThanOrEqual(1);
    }
    expect(defaultSuccessForAccount({ id: "x", mcUsername: "Y", mcUuid: null }).ok).toBe(true);
  });
});
