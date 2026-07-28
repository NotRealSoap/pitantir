import { describe, expect, it } from "vitest";
import {
  diffInventoriesByNonce,
  formatInventoryChangeDetail,
  formatInventoryChangeLabel,
} from "./inventory-diff.js";

function mystic(
  nonce: string,
  title: string,
  opts?: {
    lives?: number;
    maxLives?: number;
    slot?: number;
    enchants?: Record<string, number>;
    gemmed?: boolean;
  },
) {
  const lives = opts?.lives ?? 10;
  const maxLives = opts?.maxLives ?? 18;
  return {
    slot: opts?.slot ?? 0,
    item: {
      title,
      nonce,
      kind: "mystic",
      lives,
      maxLives,
      customEnchants: opts?.enchants ?? { lifesteal: 3 },
      lore: [
        `Lives: ${lives}/${maxLives}${opts?.gemmed ? " Gemmed" : ""}`,
        "Lifesteal 3",
      ],
    },
  };
}

function material(
  key: string,
  title: string,
  count: number,
  opts?: { slot?: number; id?: string },
) {
  return {
    slot: opts?.slot ?? 0,
    item: {
      kind: "material",
      materialKey: key,
      title,
      count,
      id: opts?.id ?? "263",
      type: opts?.id ?? "263",
    },
  };
}

function inventory(...entries: Array<ReturnType<typeof mystic> | ReturnType<typeof material>>) {
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

  it("reports updates when lives/slot change for the same nonce (max lives unchanged)", () => {
    const previous = inventory(mystic("9", "Tier III Sword", { lives: 11, slot: 0 }));
    const current = inventory(mystic("9", "Tier III Sword", { lives: 10, slot: 4 }));
    const diff = diffInventoriesByNonce(previous, current);
    expect(diff.updated).toHaveLength(1);
    expect(diff.updated[0]?.direction).toBe("updated");
    expect(formatInventoryChangeLabel(diff.updated[0]!)).toContain("→");
    expect(formatInventoryChangeLabel(diff.updated[0]!)).toContain("nonce 9");
  });

  it("treats same-nonce max-lives changes as lost + gained (not inventory_updated)", () => {
    const previous = inventory(
      mystic("6", "Tier II Dark Pants", {
        lives: 95,
        maxLives: 125,
        slot: 3,
        gemmed: true,
      }),
    );
    const current = inventory(
      mystic("6", "Tier II Dark Pants", {
        lives: 10,
        maxLives: 10,
        slot: 14,
        gemmed: true,
      }),
    );
    const diff = diffInventoriesByNonce(previous, current);
    expect(diff.updated).toHaveLength(0);
    expect(diff.lost).toHaveLength(1);
    expect(diff.gained).toHaveLength(1);
    expect(diff.lost[0]?.nonce).toBe("6");
    expect(diff.gained[0]?.nonce).toBe("6");
    expect(formatInventoryChangeDetail(diff)).toContain("lost");
    expect(formatInventoryChangeDetail(diff)).toContain("gained");
    expect(formatInventoryChangeDetail(diff)).not.toContain("updated");
  });

  it("reports stackable Pit material quantity additions and subtractions", () => {
    const previous = inventory(
      material("vile", "Chunk of Vile", 10, { slot: 1, id: "263" }),
      material("feather", "Funky Feather", 2, { slot: 2, id: "288" }),
    );
    const current = inventory(
      material("vile", "Chunk of Vile", 7, { slot: 1, id: "263" }),
      material("vile", "Chunk of Vile", 4, { slot: 5, id: "263" }),
      material("feather", "Funky Feather", 2, { slot: 2, id: "288" }),
      material("gem", "Totally Legit Gem", 1, { slot: 3, id: "388" }),
    );
    const diff = diffInventoriesByNonce(previous, current);
    // vile: 10 → 11 (+1), gem: 0 → 1 (+1)
    expect(diff.gained.map((row) => row.materialKey).sort()).toEqual(["gem", "vile"]);
    expect(diff.gained.find((row) => row.materialKey === "vile")?.summary).toBe("+1 (10 → 11)");
    expect(diff.gained.find((row) => row.materialKey === "gem")?.summary).toBe("+1 (0 → 1)");
    expect(diff.updated).toHaveLength(0);
    expect(formatInventoryChangeDetail(diff)).toContain("Chunk of Vile");
    expect(formatInventoryChangeDetail(diff)).toContain("Totally Legit Gem");
  });

  it("aggregates material losses across stacks", () => {
    const previous = inventory(
      material("shears", "Mystic Repair Kit", 3, { slot: 1, id: "359" }),
    );
    const current = inventory(
      material("shears", "Mystic Repair Kit", 1, { slot: 1, id: "359" }),
    );
    const diff = diffInventoriesByNonce(previous, current);
    expect(diff.lost).toHaveLength(1);
    expect(diff.lost[0]?.materialKey).toBe("shears");
    expect(diff.lost[0]?.quantityDelta).toBe(-2);
    expect(diff.lost[0]?.summary).toBe("-2 (3 → 1)");
  });
});
