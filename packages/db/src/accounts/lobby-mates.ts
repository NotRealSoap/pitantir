import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";
import type { Account } from "./repository.js";
import {
  formatLobbyMateBullets,
  formatLobbyMatesBlock,
  getDiscordWebhookSettings,
  isForcedDiscordDashboardOnlyUsername,
  isDiscordWebhookUrl,
  resolveNotifyFlagsForEvent,
} from "./discord-webhook.js";
import { accountIs140er } from "./presence.js";
import { notesIndicateFurryStash } from "./notes-labels.js";

export const LOBBY_MATE_SESSIONS_KEY = "pitpal_lobby_mate_sessions";

export type PitpalLobbyPlayerRef = {
  name: string;
  lobbyName: string | null;
  location?: string | null;
};

/**
 * Furry-stash lobby-mate sessions: furry-stashes notes, not 140er.
 * Downwatch-only (not on furry-stashes) accounts are excluded.
 * PitPal mute / forced-mute still apply at Discord notify time.
 */
export function shouldTrackLobbyMates(
  account: Pick<Account, "mcUsername" | "notes">,
): boolean {
  if (!notesIndicateFurryStash(account.notes)) return false;
  if (accountIs140er(account)) return false;
  return true;
}

/** Every IGN currently in a PitPal lobby (sorted), including the watched player. */
export function listLobbyMateNames(
  players: PitpalLobbyPlayerRef[],
  lobbyName: string | null | undefined,
): string[] {
  const lobby = lobbyName?.trim();
  if (!lobby) return [];
  const names = players
    .filter((player) => (player.lobbyName ?? "").trim() === lobby)
    .map((player) => player.name)
    .filter(Boolean);
  return uniqueSortedNames(names);
}

export type LobbyMateSession = {
  accountId: string;
  mcUsername: string;
  startedAt: string;
  currentLobby: string | null;
  currentLocation: string | null;
  /** Lobbies visited this Pit session, in order. */
  lobbies: string[];
  /** Cumulative IGNs that shared any lobby with them this session. */
  touchedIgns: string[];
  discordMessageId: string | null;
  lastPostedKey: string | null;
};

export type LobbyMateSessionsState = {
  sessions: LobbyMateSession[];
};

export function uniqueSortedNames(names: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    byKey.set(trimmed.toLowerCase(), trimmed);
  }
  return [...byKey.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

function mergeNames(existing: string[], incoming: string[]): string[] {
  return uniqueSortedNames([...existing, ...incoming]);
}

export function sessionPostKey(session: LobbyMateSession): string {
  return [
    session.mcUsername,
    session.currentLobby ?? "",
    session.currentLocation ?? "",
    session.lobbies.join(">"),
    session.touchedIgns.join("\t"),
  ].join("|");
}

/**
 * Advance or start a Pit lobby-touch session.
 * Accumulates every IGN seen in any lobby the watched account occupies.
 */
export function applyLobbyMateTouch(input: {
  previous: LobbyMateSession | null;
  accountId: string;
  mcUsername: string;
  lobby: string | null;
  location: string | null;
  currentMates: string[];
  at: string;
}): { session: LobbyMateSession; shouldPost: boolean; reason: "started" | "lobby" | "mates" | "noop" } {
  const currentMates = uniqueSortedNames(input.currentMates);
  const lobby = input.lobby?.trim() || null;
  const location = input.location?.trim() || null;

  if (!input.previous) {
    const session: LobbyMateSession = {
      accountId: input.accountId,
      mcUsername: input.mcUsername,
      startedAt: input.at,
      currentLobby: lobby,
      currentLocation: location,
      lobbies: lobby ? [lobby] : [],
      touchedIgns: currentMates,
      discordMessageId: null,
      lastPostedKey: null,
    };
    return { session, shouldPost: true, reason: "started" };
  }

  const lobbies = [...input.previous.lobbies];
  if (lobby && !lobbies.some((row) => row.toLowerCase() === lobby.toLowerCase())) {
    lobbies.push(lobby);
  }
  const touchedIgns = mergeNames(input.previous.touchedIgns, currentMates);
  const lobbyChanged =
    (input.previous.currentLobby ?? null) !== lobby ||
    (input.previous.currentLocation ?? null) !== location;
  const matesGrew = touchedIgns.length > input.previous.touchedIgns.length;

  const session: LobbyMateSession = {
    ...input.previous,
    mcUsername: input.mcUsername,
    currentLobby: lobby,
    currentLocation: location,
    lobbies,
    touchedIgns,
  };

  if (lobbyChanged && (input.previous.currentLobby ?? null) !== lobby) {
    return { session, shouldPost: true, reason: "lobby" };
  }
  if (matesGrew) {
    return { session, shouldPost: true, reason: "mates" };
  }
  // Location-only change still refreshes the sticky headline.
  if (lobbyChanged) {
    return { session, shouldPost: true, reason: "lobby" };
  }
  return { session, shouldPost: false, reason: "noop" };
}

export function buildLobbyMateSessionPayload(
  session: LobbyMateSession,
  options?: { ended?: boolean; at?: string },
): { content: string; embeds: Array<Record<string, unknown>>; key: string } {
  const ended = options?.ended === true;
  const at = options?.at ?? new Date().toISOString();
  const currentBits = [session.currentLobby, session.currentLocation].filter(Boolean).join(" · ");
  const headline = ended
    ? `${session.mcUsername} left Pit · session closed`
    : currentBits
      ? `${session.mcUsername} entered Pit · ${currentBits}`
      : `${session.mcUsername} entered Pit`;
  const lobbiesLine =
    session.lobbies.length > 0 ? `**Lobbies** ${session.lobbies.join(" → ")}` : null;
  const matesBlock = formatLobbyMatesBlock(
    `Touched · session`,
    session.touchedIgns,
    { maxChars: 1600 },
  );
  const content = [headline, lobbiesLine, matesBlock].filter(Boolean).join("\n\n").slice(0, 2000);
  const bullets = formatLobbyMateBullets(session.touchedIgns, { maxChars: 1000 }) ?? "_Nobody yet._";
  return {
    content,
    embeds: [
      {
        title: headline.slice(0, 256),
        color: ended ? 0x99aab5 : 0x57f287,
        fields: [
          { name: "Player", value: session.mcUsername, inline: true },
          {
            name: "Current",
            value: currentBits || (ended ? "left" : "—"),
            inline: true,
          },
          {
            name: "Touched",
            value: String(session.touchedIgns.length),
            inline: true,
          },
          ...(session.lobbies.length
            ? [{ name: "Lobbies", value: session.lobbies.join(" → ").slice(0, 1000) }]
            : []),
          {
            name: `Everyone who shared a lobby (${session.touchedIgns.length})`,
            value: bullets,
          },
        ],
        timestamp: at,
        footer: {
          text: ended
            ? "Pitantir lobby mates · session closed"
            : "Pitantir lobby mates · updated while in Pit",
        },
      },
    ],
    key: `${ended ? "ended|" : ""}${sessionPostKey(session)}`,
  };
}

function normalizeSessions(value: unknown): LobbyMateSessionsState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { sessions: [] };
  }
  const row = value as Record<string, unknown>;
  const sessions: LobbyMateSession[] = [];
  if (Array.isArray(row.sessions)) {
    for (const item of row.sessions) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.accountId !== "string" || !entry.accountId.trim()) continue;
      if (typeof entry.mcUsername !== "string" || !entry.mcUsername.trim()) continue;
      const lobbies = Array.isArray(entry.lobbies)
        ? entry.lobbies.filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
        : [];
      const touchedIgns = Array.isArray(entry.touchedIgns)
        ? uniqueSortedNames(
            entry.touchedIgns.filter((name): name is string => typeof name === "string"),
          )
        : [];
      sessions.push({
        accountId: entry.accountId.trim(),
        mcUsername: entry.mcUsername.trim(),
        startedAt:
          typeof entry.startedAt === "string" && entry.startedAt
            ? entry.startedAt
            : new Date().toISOString(),
        currentLobby: typeof entry.currentLobby === "string" ? entry.currentLobby : null,
        currentLocation:
          typeof entry.currentLocation === "string" ? entry.currentLocation : null,
        lobbies,
        touchedIgns,
        discordMessageId:
          typeof entry.discordMessageId === "string" && entry.discordMessageId.trim()
            ? entry.discordMessageId.trim()
            : null,
        lastPostedKey:
          typeof entry.lastPostedKey === "string" ? entry.lastPostedKey : null,
      });
    }
  }
  return { sessions };
}

export async function getLobbyMateSessions(db: Database): Promise<LobbyMateSessionsState> {
  const rows = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, LOBBY_MATE_SESSIONS_KEY))
    .limit(1);
  return normalizeSessions(rows[0]?.value);
}

async function saveLobbyMateSessions(
  db: Database,
  state: LobbyMateSessionsState,
): Promise<void> {
  const existing = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, LOBBY_MATE_SESSIONS_KEY))
    .limit(1);
  const stamp = now();
  if (existing[0]) {
    await db
      .update(adminSettings)
      .set({ value: state, updatedAt: stamp })
      .where(eq(adminSettings.key, LOBBY_MATE_SESSIONS_KEY));
    return;
  }
  await db.insert(adminSettings).values({
    key: LOBBY_MATE_SESSIONS_KEY,
    value: state,
    createdAt: stamp,
    updatedAt: stamp,
  });
}

async function discordFetch(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text().catch(() => "");
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }
  return { ok: response.ok, status: response.status, json, text };
}

async function upsertSessionMessage(
  webhookUrl: string,
  session: LobbyMateSession,
  payload: { content: string; embeds: Array<Record<string, unknown>>; key: string },
): Promise<LobbyMateSession> {
  if (session.lastPostedKey === payload.key && session.discordMessageId) {
    return session;
  }
  if (session.discordMessageId) {
    const edited = await discordFetch(
      `${webhookUrl}/messages/${session.discordMessageId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: payload.content,
          embeds: payload.embeds,
        }),
      },
    );
    if (edited.ok) {
      return { ...session, lastPostedKey: payload.key };
    }
  }
  const posted = await discordFetch(`${webhookUrl}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: payload.content,
      embeds: payload.embeds,
    }),
  });
  if (!posted.ok) return session;
  const messageId =
    posted.json &&
    typeof posted.json === "object" &&
    typeof (posted.json as { id?: unknown }).id === "string"
      ? (posted.json as { id: string }).id
      : null;
  return {
    ...session,
    discordMessageId: messageId,
    lastPostedKey: payload.key,
  };
}

function resolveLobbyMatesWebhookUrl(settings: {
  lobbyMatesWebhookUrl: string | null;
  pitpalStatusWebhookUrl: string | null;
}): string | null {
  const primary = settings.lobbyMatesWebhookUrl?.trim() || null;
  if (primary && isDiscordWebhookUrl(primary)) return primary;
  const fallback = settings.pitpalStatusWebhookUrl?.trim() || null;
  if (fallback && isDiscordWebhookUrl(fallback)) return fallback;
  return null;
}

/**
 * Keep cumulative lobby-touch sessions for eligible furry-stash accounts.
 * Posts/edits a sticky Discord message on the lobby-mates webhook (falls back to PitPal status).
 */
export async function syncLobbyMateSessions(
  db: Database,
  input: {
    observedAt: string;
    players: PitpalLobbyPlayerRef[];
    watchlist: Account[];
  },
): Promise<{ activeSessions: number; posted: number; closed: number }> {
  const settings = await getDiscordWebhookSettings(db);
  const webhookUrl = resolveLobbyMatesWebhookUrl(settings);
  if (!webhookUrl) return { activeSessions: 0, posted: 0, closed: 0 };

  const previousState = await getLobbyMateSessions(db);
  const previousById = new Map(
    previousState.sessions.map((session) => [session.accountId, session]),
  );
  const byName = new Map(
    input.players.map((player) => [player.name.toLowerCase(), player]),
  );

  const nextSessions: LobbyMateSession[] = [];
  let posted = 0;
  let closed = 0;

  for (const account of input.watchlist) {
    if (!shouldTrackLobbyMates(account)) {
      const stale = previousById.get(account.id);
      if (stale) {
        // Eligibility lost mid-session — close quietly.
        previousById.delete(account.id);
        closed += 1;
      }
      continue;
    }
    if (isForcedDiscordDashboardOnlyUsername(account.mcUsername)) continue;
    const flags = resolveNotifyFlagsForEvent(settings, {
      accountId: account.id,
      mcUsername: account.mcUsername,
    });
    if (!flags.notifyPitpalStatusChanges) continue;

    const hit = byName.get(account.mcUsername.toLowerCase()) ?? null;
    const previous = previousById.get(account.id) ?? null;

    if (!hit) {
      if (previous) {
        const payload = buildLobbyMateSessionPayload(previous, {
          ended: true,
          at: input.observedAt,
        });
        await upsertSessionMessage(webhookUrl, previous, payload).catch(() => previous);
        closed += 1;
        posted += 1;
      }
      continue;
    }

    const currentMates = listLobbyMateNames(input.players, hit.lobbyName);
    const applied = applyLobbyMateTouch({
      previous,
      accountId: account.id,
      mcUsername: account.mcUsername,
      lobby: hit.lobbyName,
      location: hit.location,
      currentMates,
      at: input.observedAt,
    });

    let session = applied.session;
    if (applied.shouldPost) {
      const payload = buildLobbyMateSessionPayload(session, { at: input.observedAt });
      session = await upsertSessionMessage(webhookUrl, session, payload);
      posted += 1;
    }
    nextSessions.push(session);
  }

  // Close sessions for accounts that dropped off the watchlist entirely.
  for (const leftover of previousById.values()) {
    if (nextSessions.some((session) => session.accountId === leftover.accountId)) continue;
    if (input.watchlist.some((account) => account.id === leftover.accountId)) continue;
    const payload = buildLobbyMateSessionPayload(leftover, {
      ended: true,
      at: input.observedAt,
    });
    await upsertSessionMessage(webhookUrl, leftover, payload).catch(() => leftover);
    closed += 1;
    posted += 1;
  }

  await saveLobbyMateSessions(db, { sessions: nextSessions });
  return { activeSessions: nextSessions.length, posted, closed };
}
