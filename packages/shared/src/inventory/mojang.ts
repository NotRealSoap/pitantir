/** Resolve Mojang UUID for a Minecraft username. */

export class MojangLookupError extends Error {
  constructor(
    readonly code: "not_found" | "upstream_unavailable" | "invalid_response",
    message: string,
  ) {
    super(message);
    this.name = "MojangLookupError";
  }
}

export function formatUndashedUuid(undashed: string): string {
  const hex = undashed.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new MojangLookupError("invalid_response", `Invalid UUID hex: ${undashed}`);
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeUuid(value: string): string {
  return formatUndashedUuid(value);
}

/**
 * Look up a player's UUID by username via Mojang profile APIs.
 */
export async function resolveMinecraftUuid(
  username: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const name = username.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    throw new MojangLookupError("invalid_response", "Invalid Minecraft username");
  }

  const endpoints = [
    `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
    `https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodeURIComponent(name)}`,
  ];

  let lastError: unknown = null;
  for (const url of endpoints) {
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json" },
      });
      if (response.status === 404 || response.status === 204) {
        throw new MojangLookupError("not_found", `No Minecraft profile for ${name}`);
      }
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const body = (await response.json()) as { id?: string };
      if (typeof body.id !== "string") {
        lastError = new MojangLookupError("invalid_response", "Profile missing id");
        continue;
      }
      return formatUndashedUuid(body.id);
    } catch (error) {
      if (error instanceof MojangLookupError && error.code === "not_found") {
        throw error;
      }
      lastError = error;
    }
  }

  throw new MojangLookupError(
    "upstream_unavailable",
    `Unable to resolve UUID for ${name}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
