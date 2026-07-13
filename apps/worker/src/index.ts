import { PACKAGE_NAME as dbPackageName, JobsRepository, ScanScheduler } from "@pitantir/db";
import { PACKAGE_NAME as sharedPackageName } from "@pitantir/shared";
import { WorkerLoop } from "./loop.js";
import { createWorkerRuntime, runWorkerMain } from "./runtime.js";

/** Scanner and job processors. */
export const PACKAGE_NAME = "@pitantir/worker" as const;

export function workerPackageLabel(): string {
  return `${PACKAGE_NAME} (shared=${sharedPackageName}, db=${dbPackageName})`;
}

export { WorkerLoop, createWorkerRuntime, runWorkerMain, JobsRepository, ScanScheduler };
