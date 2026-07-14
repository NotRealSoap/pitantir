import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("@pitantir/shared", () => {
  it("exports the package name constant", () => {
    expect(PACKAGE_NAME).toBe("@pitantir/shared");
  });
});
