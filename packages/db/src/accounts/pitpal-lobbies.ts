import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";
import { AccountsRepository } from "./repository.js";
import { refreshDiscordOnlineDashboard } from "./discord-webhook.js";

export const PITPAL_LOBBY_SNAPSHOT_KEY = "pitpal_lobby_snapshot";

export type PitpalLobbyLocation = "SPAWN" | "DOWN" | "OTHER" | "HUB" | string;

export type PitpalLobbyPlayer = {
  name: string;
  lobbyName: string | null;
  location: PitpalLobbyLocation | null;
  armorType?: string | null;
  killStreak?: number | null;
  isNicked?: boolean | null;
};

export type PitpalLobbySnapshot = {
  observedAt: string | null;
  source: string | null;
  players: PitpalLobbyPlayer[];
  lobbyCount?: number;
  playerCount?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coercePlayer(value: unknown): PitpalLobbyPlayer | null {
  if (!isRecord(value)) return null;
  const name =
    typeof value.name === "string"
      ? value.name.trim()
      : typeof value.mcUsername === "string"
        ? value.mcUsername.trim()
        : "";
  if (!name) return null;
  const lobbyName =
    typeof value.lobbyName === "string" && value.lobbyName.trim()
      ? value.lobbyName.trim()
      : null;
  const location =
    typeof value.location === "string" && value.location.trim()
      ? value.location.trim()
      : null;
  const armorType =
    typeof value.armorType === "string" && value.armorType.trim()
      ? value.armorType.trim()
      : null;
  const killStreak =
    typeof value.killStreak === "number" && Number.isFinite(value.killStreak)
      ? Math.trunc(value.killStreak)
      : null;
  const isNicked = typeof value.isNicked === "boolean" ? value.isNicked : null;
  return { name, lobbyName, location, armorType, killStreak, isNicked };
}

export function normalizePitpalLobbySnapshot(value: unknown): PitpalLobbySnapshot {
  if (!isRecord(value)) {
    return { observedAt: null, source: null, players: [] };
  }
  const players = Array.isArray(value.players)
    ? value.players.map(coercePlayer).filter((row): row is PitpalLobbyPlayer => Boolean(row))
    : [];
  const lobbies = new Set(players.map((row) => row.lobbyName).filter(Boolean));
  return {
    observedAt: typeof value.observedAt === "string" ? value.observedAt : null,
    source: typeof value.source === "string" ? value.source : null,
    players,
    lobbyCount: lobbies.size,
    playerCount: players.length,
  };
}

export async function getPitpalLobbySnapshot(db: Database): Promise<PitpalLobbySnapshot> {
  const rows = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, PITPAL_LOBBY_SNAPSHOT_KEY))
    .limit(1);
  return normalizePitpalLobbySnapshot(rows[0]?.value);
}

async function savePitpalLobbySnapshot(
  db: Database,
  snapshot: PitpalLobbySnapshot,
): Promise<void> {
  const existing = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, PITPAL_LOBBY_SNAPSHOT_KEY))
    .limit(1);
  if (existing[0]) {
    await db
      .update(adminSettings)
      .set({ value: snapshot, updatedAt: now() })
      .where(eq(adminSettings.key, PITPAL_LOBBY_SNAPSHOT_KEY));
    return;
  }
  await db.insert(adminSettings).values({
    key: PITPAL_LOBBY_SNAPSHOT_KEY,
    value: snapshot,
    updatedAt: now(),
  });
}

export type IngestPitpalLobbiesResult = {
  playerCount: number;
  lobbyCount: number;
  watchlistMatched: number;
  watchlistCleared: number;
  observedAt: string;
};

/**
 * Store a PitPal lobby-monitor snapshot and enrich matching watchlist accounts.
 * Players present in Pit are treated as online for Discord/watch UI.
 */
export async function ingestPitpalLobbies(
  db: Database,
  input: {
    observedAt?: string | null;
    source?: string | null;
    players: unknown[];
  },
): Promise<IngestPitpalLobbiesResult> {
  const observedAt = input.observedAt && !Number.isNaN(Date.parse(input.observedAt))
    ? new Date(input.observedAt).toISOString()
    : new Date().toISOString();
  const observedDate = new Date(observedAt);

  const players = input.players
    .map(coercePlayer)
    .filter((row): row is PitpalLobbyPlayer => Boolean(row))
    // Match PitPal UI: drop HUB and likely AFK nicked fillers.
    .filter((row) => row.location !== "HUB")
    .filter((row) => {
      const filler =
        row.name.length === 10 &&
        row.location === "OTHER" &&
        row.isNicked === false &&
        (row.killStreak ?? 0) === 0;
      return !filler;
    });

  const byName = new Map<string, PitpalLobbyPlayer>();
  for (const player of players) {
    byName.set(player.name.toLowerCase(), player);
  }

  const lobbies = new Set(
    [...byName.values()].map((row) => row.lobbyName).filter((name): name is string => Boolean(name)),
  );

  const snapshot: PitpalLobbySnapshot = {
    observedAt,
    source: input.source?.trim() || "pitpal_tampermonkey",
    players: [...byName.values()],
    lobbyCount: lobbies.size,
    playerCount: byName.size,
  };
  await savePitpalLobbySnapshot(db, snapshot);

  const repo = new AccountsRepository(db);
  const watchlist = await repo.listWatchlist();
  let matched = 0;
  let cleared = 0;

  for (const account of watchlist) {
    const hit = byName.get(account.mcUsername.toLowerCase());
    if (hit) {
      matched += 1;
      const sessionLabel = [hit.lobbyName, hit.location].filter(Boolean).join(" · ") || null;
      await repo.update(account.id, {
        lastPitpalLobby: hit.lobbyName,
        lastPitpalLocation: hit.location,
        lastPitpalArmorType: hit.armorType ?? null,
        lastPitpalKillstreak: hit.killStreak ?? null,
        lastPitpalSeenAt: observedDate,
        lastHypixelOnline: true,
        lastHypixelOnlineAt: observedDate,
        lastPresenceSource: "pitpal_lobbies",
        lastSessionGame: sessionLabel,
      });
      continue;
    }

    if (account.lastPitpalSeenAt || account.lastPitpalLobby || account.lastPitpalLocation) {
      cleared += 1;
      await repo.update(account.id, {
        lastPitpalLobby: null,
        lastPitpalLocation: null,
        lastPitpalArmorType: null,
        lastPitpalKillstreak: null,
        lastPitpalSeenAt: null,
        // Only clear online flag if it was last attributed to PitPal.
        ...(account.lastPresenceSource === "pitpal_lobbies"
          ? {
              lastHypixelOnline: false,
              lastHypixelOnlineAt: observedDate,
              lastSessionGame: null,
            }
          : {}),
      });
    }
  }

  await refreshDiscordOnlineDashboard(db, { force: true }).catch(() => undefined);

  return {
    playerCount: byName.size,
    lobbyCount: lobbies.size,
    watchlistMatched: matched,
    watchlistCleared: cleared,
    observedAt,
  };
}

export function formatPitpalPresenceLine(input: {
  mcUsername: string;
  lobby?: string | null;
  location?: string | null;
  armorType?: string | null;
  killStreak?: number | null;
}): string {
  const parts = [input.mcUsername];
  if (input.lobby) parts.push(input.lobby);
  if (input.location) parts.push(input.location);
  if (input.armorType) parts.push(input.armorType);
  if (input.killStreak && input.killStreak > 0) parts.push(`${input.killStreak} ks`);
  return parts.join(" · ");
}
