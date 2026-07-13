import { describe, expect, it } from "vitest";
import {
  formatPitBearLine,
  humanizeEnchantKey,
  pantColorFromNonce,
  parseLivesFromLore,
} from "../mystic-display.js";

describe("mystic-display", () => {
  it("maps nonce modulo 5 to pants colors", () => {
    expect(pantColorFromNonce("100")).toBe("red");
    expect(pantColorFromNonce("101")).toBe("yellow");
    expect(pantColorFromNonce("102")).toBe("blue");
    expect(pantColorFromNonce("103")).toBe("orange");
    expect(pantColorFromNonce("104")).toBe("green");
    expect(pantColorFromNonce(null)).toBeNull();
  });

  it("parses lives from lore lines", () => {
    expect(parseLivesFromLore(["Lives: 11/18", "Something else"])).toEqual({
      lives: 11,
      maxLives: 18,
    });
    expect(parseLivesFromLore(["no lives here"])).toEqual({ lives: null, maxLives: null });
  });

  it("formats PitBear-style lines", () => {
    const line = formatPitBearLine({
      lives: 11,
      maxLives: 18,
      customEnchants: { lifesteal: 3, gamble: 2 },
      gemmed: true,
      lore: ["Bottled: As strong"],
    });
    expect(line).toContain("11/18");
    expect(line).toContain("Lifesteal 3");
    expect(line).toContain("Gamble 2");
    expect(line).toContain("Gemmed");
  });

  it("humanizes enchant keys", () => {
    expect(humanizeEnchantKey("mirage")).toBe("Mirage");
    expect(humanizeEnchantKey("some_custom")).toBe("Some Custom");
    expect(humanizeEnchantKey("combo_heal")).toBe("Combo: Heal");
  });
});
