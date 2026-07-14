import { describe, expect, it } from "vitest";
import {
  describeLiveSignal,
  possessiveName,
  summarizeNonceDelta,
} from "./live-signal-copy.js";

describe("possessiveName", () => {
  it("adds 's for normal names", () => {
    expect(possessiveName("Crazy")).toBe("Crazy's");
  });

  it("adds only an apostrophe when the name already ends in s", () => {
    expect(possessiveName("Iris")).toBe("Iris'");
  });
});

describe("describeLiveSignal", () => {
  it("lists concrete item moves when changes are present", () => {
    expect(
      describeLiveSignal({
        kind: "inventory_changed",
        mcUsername: "Crazy",
        changes: [
          {
            direction: "gained",
            nonce: "123",
            title: "Tier III Mystic Sword",
            summary: "11/18 Lifesteal 3",
            slotKey: "inv:0",
          },
          {
            direction: "lost",
            nonce: "456",
            title: "Fresh Pants",
            summary: null,
            slotKey: "inv:1",
          },
        ],
      }),
    ).toBe(
      "Crazy gained Tier III Mystic Sword · 11/18 Lifesteal 3 · nonce 123; lost Fresh Pants · nonce 456",
    );
  });

  it("falls back to detail when no structured changes", () => {
    expect(
      describeLiveSignal({
        kind: "inventory_changed",
        mcUsername: "Crazy",
        detail: "+2 mystics / -1 mystic · now 14",
      }),
    ).toBe("Crazy's inventory changed · +2 mystics / -1 mystic · now 14");
  });

  it("names who came online", () => {
    expect(
      describeLiveSignal({
        kind: "came_online",
        mcUsername: "Crazy",
        detail: "PIT/pit",
      }),
    ).toBe("Crazy came online · PIT/pit");
  });
});

describe("summarizeNonceDelta", () => {
  it("counts added and removed mystics", () => {
    expect(summarizeNonceDelta(["a", "b"], ["b", "c", "d"])).toBe(
      "+2 mystics / -1 mystic · now 3",
    );
  });
});
