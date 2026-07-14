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
        { slot: 3, id: "387", title: "NumericNonce", author: "A", pages: "p", nonce: 55 },
      ],
      ender_chest: [{ slot: 0, title: "E", author: "C", nonce: "ne" }],
    });

    expect(slots.map((s) => s.slotKey)).toEqual(["echest:0", "inv:0", "inv:2", "inv:3"]);
    expect(slots[1]?.rawItem).toMatchObject({ title: "One", nonce: "n1" });
    expect(slots[3]?.rawItem).toMatchObject({ title: "NumericNonce", nonce: "55" });
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

  it("extracts mystic slots by nonce and keeps enchants", () => {
    const slots = extractBookSlots({
      inventory: [
        {
          slot: 0,
          id: "276",
          kind: "mystic",
          title: "Tier III Mystic Sword",
          nonce: 998877,
          lore: ["Billionaire III", "Lifesteal III"],
          customEnchants: { billionaire: 3, lifesteal: 3 },
        },
        { slot: 1, id: "1", count: 64 },
      ],
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]?.rawItem).toMatchObject({
      title: "Tier III Mystic Sword",
      nonce: "998877",
      kind: "mystic",
      lore: ["Billionaire III", "Lifesteal III"],
      customEnchants: { billionaire: 3, lifesteal: 3 },
    });
  });

  it("recovers Nonce + uuid from hypixelExtraAttributes when top-level nonce missing", () => {
    const slots = extractBookSlots({
      inventory: [
        {
          slot: 2,
          id: "276",
          title: "Mystic Sword",
          hypixelExtraAttributes: {
            Nonce: 777001,
            uuid: "11111111-2222-3333-4444-555555555555",
            CustomEnchants: { billionaire: 3 },
          },
        },
      ],
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]?.rawItem).toMatchObject({
      nonce: "777001",
      itemUuid: "11111111-2222-3333-4444-555555555555",
    });
  });
});
