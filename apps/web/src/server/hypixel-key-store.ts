import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ENV_FILE = ".env.local";
const KEY_NAME = "HYPIXEL_API_KEY";
const SOURCE_NAME = "INVENTORY_SOURCE";

/** In-process override so a saved key works without restarting Next.js. */
let runtimeApiKey: string | null = null;

export function getHypixelApiKey(): string | undefined {
  const fromRuntime = runtimeApiKey?.trim();
  if (fromRuntime) {
    return fromRuntime;
  }
  const fromEnv = process.env.HYPIXEL_API_KEY?.trim();
  return fromEnv || undefined;
}

export function isHypixelConfigured(): boolean {
  return Boolean(getHypixelApiKey());
}

export async function setHypixelApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (trimmed.length < 8) {
    throw new Error("API key is too short.");
  }
  if (trimmed.length > 512) {
    throw new Error("API key is too long.");
  }

  runtimeApiKey = trimmed;
  process.env.HYPIXEL_API_KEY = trimmed;
  process.env.INVENTORY_SOURCE = "hypixel_pit";
  await persistApiKey(trimmed);
}

async function persistApiKey(apiKey: string): Promise<void> {
  const filePath = path.join(process.cwd(), ENV_FILE);
  let existing = "";
  try {
    await access(filePath);
    existing = await readFile(filePath, "utf8");
  } catch {
    existing = "";
  }

  const lines = existing
    .split(/\r?\n/)
    .filter(
      (entry) =>
        entry.trim().length > 0 &&
        !entry.startsWith(`${KEY_NAME}=`) &&
        !entry.startsWith(`${SOURCE_NAME}=`),
    );

  lines.push(`${KEY_NAME}=${apiKey}`);
  lines.push(`${SOURCE_NAME}=hypixel_pit`);

  await writeFile(filePath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });

  // Mirror into repo-root .env so `pnpm start:worker` can pick it up after restart.
  await mirrorRootEnv(apiKey);
}

async function mirrorRootEnv(apiKey: string): Promise<void> {
  const rootEnv = path.join(process.cwd(), "..", "..", ".env");
  let existing = "";
  try {
    await access(rootEnv);
    existing = await readFile(rootEnv, "utf8");
  } catch {
    existing = "";
  }

  const lines = existing
    .split(/\r?\n/)
    .filter(
      (entry) =>
        entry.trim().length > 0 &&
        !entry.startsWith(`${KEY_NAME}=`) &&
        !entry.startsWith(`${SOURCE_NAME}=`),
    );
  lines.push(`${KEY_NAME}=${apiKey}`);
  lines.push(`${SOURCE_NAME}=hypixel_pit`);
  await writeFile(rootEnv, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
}
