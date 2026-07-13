import { PACKAGE_NAME as sharedPackageName } from "@pitantir/shared";

/** Next.js web app shell (implemented in later tasks). */
export const PACKAGE_NAME = "@pitantir/web" as const;

export function webPackageLabel(): string {
  return `${PACKAGE_NAME} (shared=${sharedPackageName})`;
}
