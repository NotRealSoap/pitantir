/** Hypixel online / session helpers. */

export type HypixelPresenceSource = "login_logout" | "status" | "unknown";

export interface HypixelPresence {
  /** null when we cannot determine (missing fields / hidden session). */
  online: boolean | null;
  source: HypixelPresenceSource;
  lastLoginAt: string | null;
  lastLogoutAt: string | null;
  gameType: string | null;
  mode: string | null;
  map: string | null;
  /** True when the player appears to have API session status hidden. */
  sessionHidden: boolean;
}

function msToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value).toISOString();
}

/**
 * Infer online status from Hypixel player lastLogin/lastLogout.
 * Less accurate than /v2/status, but free with the inventory scan request.
 * Players who hide session status may look offline.
 */
export function presenceFromPlayerLoginLogout(player: {
  lastLogin?: unknown;
  lastLogout?: unknown;
  settings?: { apiSession?: unknown } | null;
}): HypixelPresence {
  const lastLoginAt = msToIso(player.lastLogin);
  const lastLogoutAt = msToIso(player.lastLogout);
  const sessionHidden = player.settings?.apiSession === false;

  let online: boolean | null = null;
  if (lastLoginAt && lastLogoutAt) {
    online = new Date(lastLoginAt).getTime() > new Date(lastLogoutAt).getTime();
  } else if (lastLoginAt && !lastLogoutAt) {
    online = true;
  }

  if (sessionHidden) {
    online = online === true ? true : null;
  }

  return {
    online,
    source: "login_logout",
    lastLoginAt,
    lastLogoutAt,
    gameType: null,
    mode: null,
    map: null,
    sessionHidden,
  };
}

/**
 * Parse /v2/status response body into presence.
 */
export function presenceFromStatusResponse(
  body: unknown,
  fallback?: HypixelPresence | null,
): HypixelPresence {
  const base: HypixelPresence = fallback ?? {
    online: null,
    source: "status",
    lastLoginAt: null,
    lastLogoutAt: null,
    gameType: null,
    mode: null,
    map: null,
    sessionHidden: false,
  };

  if (!body || typeof body !== "object") {
    return { ...base, source: "status" };
  }
  const record = body as {
    success?: unknown;
    session?: {
      online?: unknown;
      gameType?: unknown;
      mode?: unknown;
      map?: unknown;
    } | null;
  };
  if (record.success === false || !record.session || typeof record.session !== "object") {
    return { ...base, source: "status", online: null };
  }

  const online = typeof record.session.online === "boolean" ? record.session.online : null;
  return {
    ...base,
    online,
    source: "status",
    gameType: typeof record.session.gameType === "string" ? record.session.gameType : null,
    mode: typeof record.session.mode === "string" ? record.session.mode : null,
    map: typeof record.session.map === "string" ? record.session.map : null,
  };
}
