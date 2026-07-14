import { describe, expect, it } from "vitest";
import { buildPitPandaSearchQuery } from "./query.js";

describe("buildPitPandaSearchQuery", () => {
  it("maps exact nonce searches", () => {
    expect(buildPitPandaSearchQuery({ kind: "exact_nonce", value: "abc-123" })).toBe("nonceabc-123");
  });

  it("maps current owner searches", () => {
    expect(buildPitPandaSearchQuery({ kind: "current_owner", value: "Notch" })).toBe("uuidNotch");
  });

  it("maps past owner searches", () => {
    expect(buildPitPandaSearchQuery({ kind: "past_owner", value: "Notch" })).toBe("pastNotch");
  });
});
