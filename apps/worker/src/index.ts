import { PACKAGE_NAME as dbPackageName } from "@pitantir/db";
import { PACKAGE_NAME as sharedPackageName } from "@pitantir/shared";

/** Scanner and job processors (implemented in later tasks). */
export const PACKAGE_NAME = "@pitantir/worker" as const;

export function workerPackageLabel(): string {
  return `${PACKAGE_NAME} (shared=${sharedPackageName}, db=${dbPackageName})`;
}
