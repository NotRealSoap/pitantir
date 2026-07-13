import { describe, expect, it } from "vitest";
import { dbPackageLabel } from "./index.js";

describe("@pitantir/db", () => {
  it("references the shared workspace package", () => {
    expect(dbPackageLabel()).toBe("@pitantir/db (uses @pitantir/shared)");
  });
});
