import { describe, expect, it } from "vitest";
import { dedupeHeldItemsByItemId, type HeldItemSummary } from "./account-history.js";

function held(overrides: Partial<HeldItemSummary> & Pick<HeldItemSummary, "itemId" | "periodId">): HeldItemSummary {
  return {
    displayName: "Pants",
    primaryNonce: "2042600219",
    category: "unique_nonce_candidate",
    identityConfidence: "medium",
    strictFingerprint: null,
    presenceStartedAt: new Date("2024-01-01T00:00:00.000Z"),
    certainty: "uncertain",
    startReason: "import",
    ...overrides,
  };
}

describe("dedupeHeldItemsByItemId", () => {
  it("keeps one row per itemId and prefers confirmed scan presence over import", () => {
    const itemId = "521d2a8d-661d-44f6-871f-a5201dbd059e";
    const result = dedupeHeldItemsByItemId([
      held({
        itemId,
        periodId: "period-import",
        certainty: "uncertain",
        startReason: "import",
        presenceStartedAt: new Date("2023-10-04T13:01:13.152Z"),
      }),
      held({
        itemId,
        periodId: "period-scan",
        certainty: "confirmed",
        startReason: "presence",
        presenceStartedAt: new Date("2026-07-13T18:00:00.000Z"),
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.periodId).toBe("period-scan");
    expect(result[0]?.certainty).toBe("confirmed");
  });

  it("uses unique periodIds even when itemIds collide before dedupe", () => {
    const itemId = "521d2a8d-661d-44f6-871f-a5201dbd059e";
    const duplicates = [
      held({ itemId, periodId: "a" }),
      held({ itemId, periodId: "b" }),
    ];
    const keys = new Set(duplicates.map((row) => row.periodId));
    expect(keys.size).toBe(2);
    expect(dedupeHeldItemsByItemId(duplicates)).toHaveLength(1);
  });
});
