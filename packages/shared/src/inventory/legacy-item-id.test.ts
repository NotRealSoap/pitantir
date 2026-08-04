import { describe, expect, it } from "vitest";
import { normalizeItemMeta, resolveLegacyItemId } from "./legacy-item-id.js";

describe("resolveLegacyItemId", () => {
  it("maps mystic swords to golden sword and vile to coal", () => {
    expect(resolveLegacyItemId({ id: 283 })).toBe(283);
    expect(resolveLegacyItemId({ id: "minecraft:golden_sword" })).toBe(283);
    expect(resolveLegacyItemId({ id: "263" })).toBe(263);
    expect(resolveLegacyItemId({ id: null, title: "Chunk of Vile" })).toBe(263);
    expect(resolveLegacyItemId({ id: null, title: "Tier III Sword" })).toBe(283);
    expect(resolveLegacyItemId({ id: null, title: "Rage Pants" })).toBe(300);
  });

  it("normalizes leather color meta", () => {
    expect(normalizeItemMeta("ffaa00")).toBe("FFAA00");
    expect(normalizeItemMeta(0)).toBe(0);
    expect(normalizeItemMeta("3")).toBe(3);
  });
});
