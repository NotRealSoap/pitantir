import { describe, expect, it } from "vitest";
import {
  diffInventoriesByNonce,
  formatInventoryChangeDetail,
  formatInventoryChangeLabel,
} from "./inventory-diff.js";

function mystic(
  nonce: string,
  title: string,
  opts?: { lives?: number; maxLives?: number; slot?: number; enchants?: Record<string, number> },
) {
  return {
    slot: opts?.slot ?? 0,
    item: {
      title,
      nonce,
      kind: "mystic",
      lives: opts?.lives ?? 10,
      maxLives: opts?.maxLives ?? 18,
      customEnchants: opts?.enchants ?? { lifesteal: 3 },
      lore: [`Lives: ${opts?.lives ?? 10}/${opts?.maxLives ?? 18}`, "Lifesteal 3"],
    },
  };
}

function inventory(...entries: ReturnType<typeof mystic>[]) {
  return { inventory: entries };
}

describe("diffInventoriesByNonce", () => {
  it("reports gained and lost items by nonce with titles", () => {
    const previous = inventory(
      mystic("111", "Fresh Pants", { slot: 1 }),
      mystic("222", "Tier II Sword", { slot: 2 }),
    );
    const current = inventory(
      mystic("222", "Tier II Sword", { slot: 2 }),
      mystic("333", "Tier III Bow", { slot: 3, enchants: { telebow: 3 } }),
    );

    const diff = diffInventoriesByNonce(previous, current);
    expect(diff.gained.map((row) => row.nonce)).toEqual(["333"]);
    expect(diff.lost.map((row) => row.nonce)).toEqual(["111"]);
    expect(diff.gained[0]?.title).toBe("Tier III Bow");
    expect(diff.lost[0]?.title).toBe("Fresh Pants");
    expect(formatInventoryChangeDetail(diff)).toContain("gained Tier III Bow");
    expect(formatInventoryChangeDetail(diff)).toContain("lost Fresh Pants");
    expect(formatInventoryChangeDetail(diff)).toContain("nonce 333");
  });

  it("reports updates when lives/slot change for the same nonce", () => {
    const previous = inventory(mystic("9", "Tier III Sword", { lives: 11, slot: 0 }));
    const current = inventory(mystic("9", "Tier III Sword", { lives: 10, slot: 4 }));
    const diff = diffInventoriesByNonce(previous, current);
    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0]?.direction).toBe("updated");
    expect(formatInventoryChangeLabel(diff.updated[0]!)).toContain("→");
    expect(formatInventoryChangeLabel(diff.updated[0]!)).toContain("nonce 9");
  });
});
