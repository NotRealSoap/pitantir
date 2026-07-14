/** Resolve Mojang UUID / username for Minecraft profiles. */

import { formatUndashedUuid, normalizeUuid } from "../minecraft/uuid.js";

export { formatUndashedUuid, normalizeUuid } from "../minecraft/uuid.js";

export class MojangLookupError extends Error {
  constructor(
    readonly code: "not_found" | "upstream_unavailable" | "invalid_response",
    message: string,
  ) {
    super(message);
    this.name = "MojangLookupError";
  }
}

export interface MinecraftProfile {
  username: string;
  uuid: string;
}

/**
 * Look up a player's UUID by username via Mojang profile APIs.
 */
export async function resolveMinecraftUuid(
  username: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const profile = await resolveMinecraftProfileByUsername(username, fetchImpl);
  return profile.uuid;
}

/**
 * Look up username + UUID by username.
 */
export async function resolveMinecraftProfileByUsername(
  username: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MinecraftProfile> {
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
      const body = (await response.json()) as { id?: string; name?: string };
      if (typeof body.id !== "string") {
        lastError = new MojangLookupError("invalid_response", "Profile missing id");
        continue;
      }
      try {
        return {
          uuid: formatUndashedUuid(body.id),
          username: typeof body.name === "string" && body.name.trim() ? body.name.trim() : name,
        };
      } catch {
        throw new MojangLookupError("invalid_response", `Invalid UUID hex: ${body.id}`);
      }
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

/**
 * Look up username by UUID via Mojang session server.
 */
export async function resolveMinecraftProfileByUuid(
  uuid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MinecraftProfile> {
  let normalized: string;
  try {
    normalized = normalizeUuid(uuid);
  } catch {
    throw new MojangLookupError("invalid_response", "Invalid Minecraft UUID");
  }
  const undashed = normalized.replace(/-/g, "");
  const url = `https://sessionserver.mojang.com/session/minecraft/profile/${undashed}`;

  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
    });
    if (response.status === 204 || response.status === 404) {
      throw new MojangLookupError("not_found", `No Minecraft profile for UUID ${normalized}`);
    }
    if (!response.ok) {
      throw new MojangLookupError(
        "upstream_unavailable",
        `Mojang profile lookup failed (HTTP ${response.status})`,
      );
    }
    const body = (await response.json()) as { id?: string; name?: string };
    if (typeof body.name !== "string" || !body.name.trim()) {
      throw new MojangLookupError("invalid_response", "Profile missing name");
    }
    return {
      username: body.name.trim(),
      uuid: typeof body.id === "string" ? formatUndashedUuid(body.id) : normalized,
    };
  } catch (error) {
    if (error instanceof MojangLookupError) throw error;
    throw new MojangLookupError(
      "upstream_unavailable",
      `Unable to resolve username for UUID: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
