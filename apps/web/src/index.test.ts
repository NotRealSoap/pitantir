import { describe, expect, it } from "vitest";
import { webPackageLabel } from "./index.js";

describe("@pitantir/web", () => {
  it("references the shared workspace package", () => {
    expect(webPackageLabel()).toBe("@pitantir/web (shared=@pitantir/shared)");
  });
});
