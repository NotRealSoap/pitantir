import { describe, expect, it } from "vitest";
import { normalizeText, computeStrictFingerprint, fingerprintFromRawItem } from "./fingerprint.js";

describe("fingerprints", () => {
  it("normalizes unicode and whitespace", () => {
    expect(normalizeText("  Ancient\u00A0Tome  ")).toBe("Ancient Tome");
  });

  it("produces stable strict fingerprints", () => {
    const first = computeStrictFingerprint(
      { title: "A", author: "B", pageContentHash: "hash", generation: "g1" },
      "nonce-1",
    );
    const second = computeStrictFingerprint(
      { title: "A", author: "B", pageContentHash: "hash", generation: "g1" },
      "nonce-1",
    );
    expect(first).toBe(second);
    expect(first.startsWith("v1:strict:")).toBe(true);
  });

  it("excludes volatile inventory fields from raw item fingerprinting", () => {
    const base = fingerprintFromRawItem({
      title: "Book",
      author: "Author",
      pages: "same",
      slot: "inv:99",
      count: 5,
      nonce: "n1",
    });
    const withDifferentSlot = fingerprintFromRawItem({
      title: "Book",
      author: "Author",
      pages: "same",
      slot: "inv:100",
      count: 9,
      nonce: "n1",
    });
    expect(base.strictFingerprint).toBe(withDifferentSlot.strictFingerprint);
  });

  it("coerces numeric nonces from raw inventory items", () => {
    const fromNumber = fingerprintFromRawItem({
      title: "Book",
      author: "Author",
      pages: "x",
      nonce: 421337,
    });
    expect(fromNumber.nonce).toBe("421337");
  });

  it("fingerprints mystic items from custom enchants when pages are absent", () => {
    const first = fingerprintFromRawItem({
      title: "Tier III Mystic Sword",
      nonce: "998877",
      customEnchants: { billionaire: 3, lifesteal: 3 },
      lore: ["Billionaire III", "Lifesteal III"],
    });
    const second = fingerprintFromRawItem({
      title: "Tier III Mystic Sword",
      nonce: "998877",
      customEnchants: { lifesteal: 3, billionaire: 3 },
    });
    expect(first.nonce).toBe("998877");
    expect(first.metadata.pageContentHash).toBeTruthy();
    expect(first.strictFingerprint).toBe(second.strictFingerprint);
  });
});
