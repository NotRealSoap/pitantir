import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";
import { AccountsRepository, type Account } from "./repository.js";
import {
  notifyPitpalStatusEvents,
  refreshDiscordOnlineDashboard,
  type DiscordNotifyEvent,
} from "./discord-webhook.js";
import { JobsRepository } from "../jobs/repository.js";

export const PITPAL_LOBBY_SNAPSHOT_KEY = "pitpal_lobby_snapshot";

/** Treat PitPal as source of truth when the last ingest is newer than this. */
export const PITPAL_FRESH_MS = 90_000;

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

export function isPitpalSnapshotFresh(
  snapshot: PitpalLobbySnapshot,
  maxAgeMs: number = PITPAL_FRESH_MS,
  nowMs: number = Date.now(),
): boolean {
  if (!snapshot.observedAt) return false;
  const at = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(at)) return false;
  return nowMs - at <= maxAgeMs;
}

export async function isPitpalPresenceAuthoritative(
  db: Database,
  maxAgeMs: number = PITPAL_FRESH_MS,
): Promise<boolean> {
  const snapshot = await getPitpalLobbySnapshot(db);
  return isPitpalSnapshotFresh(snapshot, maxAgeMs);
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

function statusKey(player: {
  lobbyName?: string | null;
  location?: string | null;
}): string {
  return `${player.lobbyName ?? ""}|${player.location ?? ""}`;
}

function buildStatusEvents(input: {
  account: Account;
  previous: { lobby: string | null; location: string | null } | null;
  next: PitpalLobbyPlayer | null;
  at: string;
}): DiscordNotifyEvent[] {
  const { account, previous, next, at } = input;
  const events: DiscordNotifyEvent[] = [];
  const wasIn = Boolean(previous?.lobby || previous?.location);
  const nowIn = Boolean(next);

  if (!wasIn && nowIn && next) {
    events.push({
      kind: "pitpal_entered",
      accountId: account.id,
      mcUsername: account.mcUsername,
      at,
      detail: [next.lobbyName, next.location, next.armorType].filter(Boolean).join(" · "),
    });
    return events;
  }
  if (wasIn && !nowIn) {
    events.push({
      kind: "pitpal_left",
      accountId: account.id,
      mcUsername: account.mcUsername,
      at,
      detail: [previous?.lobby, previous?.location].filter(Boolean).join(" · ") || null,
    });
    return events;
  }
  if (wasIn && nowIn && next && previous) {
    if ((previous.location ?? null) !== (next.location ?? null)) {
      events.push({
        kind: "pitpal_location",
        accountId: account.id,
        mcUsername: account.mcUsername,
        at,
        detail: `${previous.location ?? "?"} → ${next.location ?? "?"}${
          next.lobbyName ? ` · ${next.lobbyName}` : ""
        }`,
      });
    }
    if ((previous.lobby ?? null) !== (next.lobbyName ?? null)) {
      events.push({
        kind: "pitpal_lobby",
        accountId: account.id,
        mcUsername: account.mcUsername,
        at,
        detail: `${previous.lobby ?? "?"} → ${next.lobbyName ?? "?"}${
          next.location ? ` · ${next.location}` : ""
        }`,
      });
    }
  }
  return events;
}

export type IngestPitpalLobbiesResult = {
  playerCount: number;
  lobbyCount: number;
  watchlistMatched: number;
  watchlistCleared: number;
  statusEventsPosted: number;
  mismatchesQueued: number;
  observedAt: string;
};

/**
 * Store a PitPal lobby-monitor snapshot and enrich matching watchlist accounts.
 * PitPal is the presence source of truth while the Tampermonkey feed is active.
 */
export async function ingestPitpalLobbies(
  db: Database,
  input: {
    observedAt?: string | null;
    source?: string | null;
    players: unknown[];
  },
): Promise<IngestPitpalLobbiesResult> {
  const observedAt =
    input.observedAt && !Number.isNaN(Date.parse(input.observedAt))
      ? new Date(input.observedAt).toISOString()
      : new Date().toISOString();
  const observedDate = new Date(observedAt);

  const players = input.players
    .map(coercePlayer)
    .filter((row): row is PitpalLobbyPlayer => Boolean(row))
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
    [...byName.values()]
      .map((row) => row.lobbyName)
      .filter((name): name is string => Boolean(name)),
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
  const jobs = new JobsRepository(db);
  const watchlist = await repo.listWatchlist();
  let matched = 0;
  let cleared = 0;
  let mismatchesQueued = 0;
  const statusEvents: DiscordNotifyEvent[] = [];

  for (const account of watchlist) {
    const hit = byName.get(account.mcUsername.toLowerCase());
    const previous = {
      lobby: account.lastPitpalLobby,
      location: account.lastPitpalLocation,
    };
    const hadPitpal = Boolean(previous.lobby || previous.location || account.lastPitpalSeenAt);

    if (hit) {
      matched += 1;
      const sessionLabel = [hit.lobbyName, hit.location].filter(Boolean).join(" · ") || null;
      if (statusKey(previous) !== statusKey({ lobbyName: hit.lobbyName, location: hit.location })) {
        statusEvents.push(
          ...buildStatusEvents({
            account,
            previous: hadPitpal ? previous : null,
            next: hit,
            at: observedAt,
          }),
        );
      }
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

    if (hadPitpal) {
      cleared += 1;
      statusEvents.push(
        ...buildStatusEvents({
          account,
          previous,
          next: null,
          at: observedAt,
        }),
      );
      await repo.update(account.id, {
        lastPitpalLobby: null,
        lastPitpalLocation: null,
        lastPitpalArmorType: null,
        lastPitpalKillstreak: null,
        lastPitpalSeenAt: null,
        lastHypixelOnline: false,
        lastHypixelOnlineAt: observedDate,
        lastPresenceSource: "pitpal_lobbies",
        lastSessionGame: null,
      });
      continue;
    }

    // Incongruence: Hypixel/watch thinks online, but fresh PitPal does not list them.
    // Queue a Hypixel inventory index scan to verify (PitPanda key is for items; Hypixel
    // scans are the player-index path in this app).
    if (
      account.lastHypixelOnline === true &&
      account.lastPresenceSource !== "pitpal_lobbies"
    ) {
      statusEvents.push({
        kind: "pitpal_mismatch",
        accountId: account.id,
        mcUsername: account.mcUsername,
        at: observedAt,
        detail: "Hypixel/watch online, absent from PitPal lobbies — queued index scan",
      });
      try {
        await jobs.enqueue({
          type: "scan_account",
          payload: { accountId: account.id, triggeredBy: "manual" },
          priority: 20,
          idempotencyKey: `pitpal_mismatch_scan:${account.id}:${observedAt.slice(0, 16)}`,
        });
        mismatchesQueued += 1;
      } catch {
        // enqueue is best-effort
      }
    }
  }

  const statusEventsPosted = await notifyPitpalStatusEvents(db, statusEvents);
  await refreshDiscordOnlineDashboard(db, { force: true }).catch(() => undefined);

  return {
    playerCount: byName.size,
    lobbyCount: lobbies.size,
    watchlistMatched: matched,
    watchlistCleared: cleared,
    statusEventsPosted,
    mismatchesQueued,
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
