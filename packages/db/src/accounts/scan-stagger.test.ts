import { describe, expect, it } from "vitest";
import { staggeredNextScanAts } from "./scan-stagger.js";

describe("staggeredNextScanAts", () => {
  it("rebalances with first due now and others spaced", () => {
    const from = new Date("2026-07-14T04:00:00.000Z");
    const times = staggeredNextScanAts({
      count: 4,
      intervalSeconds: 400,
      from,
      mode: "rebalance",
    });
    expect(times).toHaveLength(4);
    expect(times[0]!.toISOString()).toBe("2026-07-14T04:00:00.000Z");
    expect(times[1]!.toISOString()).toBe("2026-07-14T04:01:40.000Z");
    expect(times[2]!.toISOString()).toBe("2026-07-14T04:03:20.000Z");
    expect(times[3]!.toISOString()).toBe("2026-07-14T04:05:00.000Z");
  });

  it("after a due burst, next wave starts at interval/count not zero", () => {
    const from = new Date("2026-07-14T04:00:00.000Z");
    const times = staggeredNextScanAts({
      count: 4,
      intervalSeconds: 400,
      from,
      mode: "after_burst",
    });
    expect(times[0]!.toISOString()).toBe("2026-07-14T04:01:40.000Z");
    expect(times[3]!.toISOString()).toBe("2026-07-14T04:06:40.000Z");
  });
});
