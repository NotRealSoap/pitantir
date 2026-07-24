import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now, newId } from "../identity/store.js";
import { AccountsRepository, type Account } from "./repository.js";
import {
  notifyDiscordForLiveEvents,
  notifyDownwatchWentDown,
  notifyPitpalStatusEvents,
  refreshDiscordOnlineDashboard,
  type DiscordNotifyEvent,
} from "./discord-webhook.js";
import { appendHypixelLiveEvents, type HypixelLiveEvent } from "./live-events.js";
import { JobsRepository } from "../jobs/repository.js";
import {
  accountIs140er,
  hotNextScanAt,
  PRESENCE_HOT_INTERVAL_SECONDS,
  PRESENCE_HOT_PRIORITY,
  resolveEffectivePresence,
} from "./presence.js";

export const PITPAL_LOBBY_SNAPSHOT_KEY = "pitpal_lobby_snapshot";

/** PitPal feed is considered fresh within this window (UI / mismatch heuristics). */
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

async function enqueueHypixelPresenceConfirm(
  jobs: JobsRepository,
  accountId: string,
  reason: "entered" | "left" | "mismatch",
  observedAt: string,
): Promise<boolean> {
  try {
    // Enter/leave: hourly. Mismatch: daily (avoids spam for players online outside Pit).
    const bucket = reason === "mismatch" ? observedAt.slice(0, 10) : observedAt.slice(0, 13);
    const result = await jobs.enqueue({
      type: "scan_account",
      payload: { accountId, triggeredBy: "manual", reason: `pitpal_${reason}` },
      priority: reason === "mismatch" ? 20 : 15,
      idempotencyKey: `pitpal_confirm_${reason}:${accountId}:${bucket}`,
    });
    return result.created;
  } catch {
    return false;
  }
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
  const nicked = next?.isNicked === true ? true : null;

  if (!wasIn && nowIn && next) {
    events.push({
      kind: "pitpal_entered",
      accountId: account.id,
      mcUsername: account.mcUsername,
      at,
      isNicked: nicked,
      detail: [next.lobbyName, next.location, next.armorType, nicked ? "Nicked" : null]
        .filter(Boolean)
        .join(" · "),
    });
    return events;
  }
  if (wasIn && !nowIn) {
    events.push({
      kind: "pitpal_left",
      accountId: account.id,
      mcUsername: account.mcUsername,
      at,
      isNicked: account.lastPitpalIsNicked === true ? true : null,
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
        isNicked: nicked,
        detail: `${previous.location ?? "?"} → ${next.location ?? "?"}${
          next.lobbyName ? ` · ${next.lobbyName}` : ""
        }${nicked ? " · Nicked" : ""}`,
      });
    }
    if ((previous.lobby ?? null) !== (next.lobbyName ?? null)) {
      events.push({
        kind: "pitpal_lobby",
        accountId: account.id,
        mcUsername: account.mcUsername,
        at,
        isNicked: nicked,
        detail: `${previous.lobby ?? "?"} → ${next.lobbyName ?? "?"}${
          next.location ? ` · ${next.location}` : ""
        }${nicked ? " · Nicked" : ""}`,
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
  statusEventsGenerated: number;
  statusEventsPosted: number;
  presenceConfirmsQueued: number;
  observedAt: string;
};

/**
 * Store a PitPal lobby-monitor snapshot and emit PitPal status Discord events.
 *
 * - PitPal status webhook: lobby enter/leave/SPAWN/DOWN changes (append-only).
 * - Username casing: PitPal lobby spelling is source of truth while listed.
 * - Online-ness: while this feed is fresh, PitPal listing alone decides online
 *   (Hypixel API Off cannot hide someone; Hypixel "online" alone cannot invent them).
 * - Presence alerts: enter/leave also emit came_online / went_offline when effective
 *   presence flips under PitPal-authoritative rules.
 * - Hot schedule: pull nextScanAt forward for lobby-active accounts.
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

  const previousSnapshot = await getPitpalLobbySnapshot(db);
  const previousByName = new Map(
    previousSnapshot.players.map((row) => [row.name.toLowerCase(), row]),
  );

  const snapshot: PitpalLobbySnapshot = {
    observedAt,
    source: input.source?.trim() || "pitpal_tampermonkey",
    players: [...byName.values()],
    lobbyCount: lobbies.size,
    playerCount: byName.size,
  };
  await savePitpalLobbySnapshot(db, snapshot);

  // Fresh snapshot just saved → PitPal is the online source of truth for this ingest.
  const presenceOpts = { pitpalAuthoritative: true as const, nowMs: observedDate.getTime() };

  const repo = new AccountsRepository(db);
  const jobs = new JobsRepository(db);
  const watchlist = await repo.listWatchlist();
  let matched = 0;
  let cleared = 0;
  let presenceConfirmsQueued = 0;
  const statusEvents: DiscordNotifyEvent[] = [];
  const presenceLiveEvents: HypixelLiveEvent[] = [];

  for (const account of watchlist) {
    const key = account.mcUsername.toLowerCase();
    const hit = byName.get(key) ?? null;
    const prevPlayer = previousByName.get(key) ?? null;
    const previousFromAccount =
      account.lastPitpalLobby || account.lastPitpalLocation
        ? { lobby: account.lastPitpalLobby, location: account.lastPitpalLocation }
        : null;
    const previous = prevPlayer
      ? { lobby: prevPlayer.lobbyName, location: prevPlayer.location }
      : previousFromAccount;

    if (hit) {
      matched += 1;
      const previousEffective = resolveEffectivePresence(account, presenceOpts);
      const events = buildStatusEvents({
        account,
        previous,
        next: hit,
        at: observedAt,
      });
      statusEvents.push(...events);
      const sessionLabel = [hit.lobbyName, hit.location].filter(Boolean).join(" · ") || null;
      const casingPatch =
        hit.name && hit.name !== account.mcUsername ? { mcUsername: hit.name } : {};
      // Non-140ers: pull Hypixel confirm forward. 140ers keep ≥30m index floor.
      const allowHotPull = !accountIs140er(account);
      const hotAt = hotNextScanAt(
        observedDate,
        account.id.split("").reduce((n, c) => n + c.charCodeAt(0), 0),
      );
      const nextScanAt =
        allowHotPull &&
        account.nextScanAt.getTime() >
          observedDate.getTime() + PRESENCE_HOT_INTERVAL_SECONDS * 1000
          ? hotAt
          : undefined;
      const updated = await repo.update(account.id, {
        ...casingPatch,
        lastPitpalLobby: hit.lobbyName,
        lastPitpalLocation: hit.location,
        lastPitpalArmorType: hit.armorType ?? null,
        lastPitpalKillstreak: hit.killStreak ?? null,
        lastPitpalSeenAt: observedDate,
        lastPitpalIsNicked: hit.isNicked === true ? true : hit.isNicked === false ? false : null,
        lastSessionGame: sessionLabel,
        ...(allowHotPull
          ? { priority: Math.min(account.priority, PRESENCE_HOT_PRIORITY) }
          : {}),
        ...(nextScanAt ? { nextScanAt } : {}),
      });
      const nextEffective = resolveEffectivePresence(updated, presenceOpts);
      if (nextEffective.online && !previousEffective.online) {
        presenceLiveEvents.push({
          id: newId(),
          kind: "came_online",
          accountId: account.id,
          mcUsername: updated.mcUsername,
          at: observedAt,
          isNicked: hit.isNicked === true ? true : null,
          detail: nextEffective.apiOff
            ? [sessionLabel, "API Off", hit.isNicked === true ? "Nicked" : null]
                .filter(Boolean)
                .join(" · ")
            : [sessionLabel, hit.isNicked === true ? "Nicked" : null].filter(Boolean).join(" · ") ||
              null,
        });
      }
      if (events.some((event) => event.kind === "pitpal_entered")) {
        if (await enqueueHypixelPresenceConfirm(jobs, account.id, "entered", observedAt)) {
          presenceConfirmsQueued += 1;
        }
      }
      continue;
    }

    if (previous) {
      cleared += 1;
      const previousEffective = resolveEffectivePresence(account, presenceOpts);
      const events = buildStatusEvents({
        account,
        previous,
        next: null,
        at: observedAt,
      });
      statusEvents.push(...events);
      const updated = await repo.update(account.id, {
        lastPitpalLobby: null,
        lastPitpalLocation: null,
        lastPitpalArmorType: null,
        lastPitpalKillstreak: null,
        lastPitpalSeenAt: null,
        lastPitpalIsNicked: null,
      });
      const nextEffective = resolveEffectivePresence(updated, presenceOpts);
      if (!nextEffective.online && previousEffective.online) {
        presenceLiveEvents.push({
          id: newId(),
          kind: "went_offline",
          accountId: account.id,
          mcUsername: account.mcUsername,
          at: observedAt,
          isNicked: account.lastPitpalIsNicked === true ? true : null,
          detail:
            account.lastPitpalIsNicked === true
              ? [previous?.lobby, previous?.location, "Nicked"].filter(Boolean).join(" · ")
              : [previous?.lobby, previous?.location].filter(Boolean).join(" · ") || null,
        });
      }
      if (await enqueueHypixelPresenceConfirm(jobs, account.id, "left", observedAt)) {
        presenceConfirmsQueued += 1;
      }
      continue;
    }

    // Hypixel/watch thinks online, but fresh PitPal does not list them → confirm via Hypixel.
    // Discord mismatch only when we actually enqueue a new confirmatory scan (daily).
    // Under PitPal-authoritative mode they are already treated as offline on dashboards.
    if (account.lastHypixelOnline === true && !previousByName.has(key)) {
      const queued = await enqueueHypixelPresenceConfirm(
        jobs,
        account.id,
        "mismatch",
        observedAt,
      );
      if (queued) {
        presenceConfirmsQueued += 1;
        statusEvents.push({
          kind: "pitpal_mismatch",
          accountId: account.id,
          mcUsername: account.mcUsername,
          at: observedAt,
          detail: "Hypixel online, absent from PitPal lobbies — queued confirmatory scan",
        });
      }
    }
  }

  const statusEventsPosted = await notifyPitpalStatusEvents(db, statusEvents);
  const downwatchPosted = await notifyDownwatchWentDown(db, statusEvents).catch(() => 0);
  if (presenceLiveEvents.length > 0) {
    await appendHypixelLiveEvents(db, presenceLiveEvents).catch(() => undefined);
    await notifyDiscordForLiveEvents(db, presenceLiveEvents).catch(() => undefined);
  }
  // Soft-online roster (incl. API Off) lives on the presence dashboard.
  await refreshDiscordOnlineDashboard(db, { force: true }).catch(() => undefined);

  return {
    playerCount: byName.size,
    lobbyCount: lobbies.size,
    watchlistMatched: matched,
    watchlistCleared: cleared,
    statusEventsGenerated: statusEvents.length,
    statusEventsPosted: statusEventsPosted + downwatchPosted,
    presenceConfirmsQueued,
    observedAt,
  };
}

export function formatPitpalPresenceLine(input: {
  mcUsername: string;
  lobby?: string | null;
  location?: string | null;
  armorType?: string | null;
  killStreak?: number | null;
  isNicked?: boolean | null;
}): string {
  const parts = [input.mcUsername];
  if (input.lobby) parts.push(input.lobby);
  if (input.location) parts.push(input.location);
  if (input.armorType) parts.push(input.armorType);
  if (input.killStreak && input.killStreak > 0) parts.push(`${input.killStreak} ks`);
  if (input.isNicked === true) parts.push("Nicked");
  return parts.join(" · ");
}
