import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ENV_FILE = ".env.local";
const KEY_NAME = "PITPANDA_API_KEY";

/** In-process override so a saved key works without restarting Next.js. */
let runtimeApiKey: string | null = null;

export function getPitPandaApiKey(): string | undefined {
  const fromRuntime = runtimeApiKey?.trim();
  if (fromRuntime) {
    return fromRuntime;
  }
  const fromEnv = process.env.PITPANDA_API_KEY?.trim();
  return fromEnv || undefined;
}

export function isPitPandaConfigured(): boolean {
  return Boolean(getPitPandaApiKey());
}

export async function setPitPandaApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (trimmed.length < 8) {
    throw new Error("API key is too short.");
  }
  if (trimmed.length > 512) {
    throw new Error("API key is too long.");
  }

  runtimeApiKey = trimmed;
  process.env.PITPANDA_API_KEY = trimmed;
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

  const line = `${KEY_NAME}=${apiKey}`;
  const lines = existing
    .split(/\r?\n/)
    .filter((entry) => entry.trim().length > 0 && !entry.startsWith(`${KEY_NAME}=`));

  if (!lines.some((entry) => entry.startsWith("ITEM_DATA_PROVIDER="))) {
    lines.push("ITEM_DATA_PROVIDER=pitpanda");
  }
  lines.push(line);

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
        !entry.startsWith("ITEM_DATA_PROVIDER="),
    );

  lines.push("ITEM_DATA_PROVIDER=pitpanda");
  lines.push(`${KEY_NAME}=${apiKey}`);
  await writeFile(rootEnv, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
}
