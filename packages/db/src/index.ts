import { PACKAGE_NAME as sharedPackageName } from "@pitantir/shared";

/** Database schema and repositories (implemented in later tasks). */
export const PACKAGE_NAME = "@pitantir/db" as const;

export function dbPackageLabel(): string {
  return `${PACKAGE_NAME} (uses ${sharedPackageName})`;
}
