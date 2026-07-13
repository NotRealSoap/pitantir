import { describe, expect, it } from "vitest";
import { workerPackageLabel, WorkerLoop } from "./index.js";

describe("@pitantir/worker", () => {
  it("wires workspace dependencies", () => {
    expect(workerPackageLabel()).toContain("@pitantir/worker");
    expect(workerPackageLabel()).toContain("@pitantir/shared");
    expect(workerPackageLabel()).toContain("@pitantir/db");
    expect(WorkerLoop.name).toBe("WorkerLoop");
  });
});
