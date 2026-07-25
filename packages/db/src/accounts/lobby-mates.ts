import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";
import type { Account } from "./repository.js";
import {
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

/** First time this IGN shared a specific lobby with the watched account. */
export type LobbyMateTouch = {
  mcUsername: string;
  lobby: string;
  at: string;
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
  /** Per IGN×lobby first-touch records for this session. */
  touches: LobbyMateTouch[];
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

export function touchKey(mcUsername: string, lobby: string): string {
  return `${mcUsername.trim().toLowerCase()}\t${lobby.trim().toLowerCase()}`;
}

export function mergeLobbyMateTouches(
  existing: LobbyMateTouch[],
  incoming: LobbyMateTouch[],
): LobbyMateTouch[] {
  const byKey = new Map<string, LobbyMateTouch>();
  for (const touch of existing) {
    byKey.set(touchKey(touch.mcUsername, touch.lobby), touch);
  }
  for (const touch of incoming) {
    const key = touchKey(touch.mcUsername, touch.lobby);
    if (!byKey.has(key)) byKey.set(key, touch);
  }
  return [...byKey.values()];
}

export function formatTouchClock(at: string): string {
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return at;
  // Discord localized short time — renders in each viewer's timezone.
  return `<t:${Math.floor(ms / 1000)}:t>`;
}

/** Group touches by lobby (session order), players by first-seen time then name. */
export function formatLobbyMateTouchesBlock(
  session: Pick<LobbyMateSession, "lobbies" | "touches">,
  options?: { maxChars?: number },
): string | null {
  if (session.touches.length === 0) return null;
  const maxChars = options?.maxChars ?? 1800;
  const lobbyOrder = [...session.lobbies];
  for (const touch of session.touches) {
    if (!lobbyOrder.some((lobby) => lobby.toLowerCase() === touch.lobby.toLowerCase())) {
      lobbyOrder.push(touch.lobby);
    }
  }

  const chunks: string[] = [];
  let used = 0;
  let omitted = 0;

  for (const lobby of lobbyOrder) {
    const touches = session.touches
      .filter((touch) => touch.lobby.toLowerCase() === lobby.toLowerCase())
      .sort((a, b) => {
        const time = Date.parse(a.at) - Date.parse(b.at);
        if (time !== 0) return time;
        return a.mcUsername.localeCompare(b.mcUsername, undefined, { sensitivity: "base" });
      });
    if (touches.length === 0) continue;

    const header = `**${lobby} (${touches.length})**`;
    const lines = touches.map(
      (touch) => `• ${touch.mcUsername} — ${formatTouchClock(touch.at)}`,
    );
    const block = [header, ...lines].join("\n");
    const next = used === 0 ? block.length : used + 2 + block.length;
    if (next > maxChars) {
      omitted += touches.length;
      continue;
    }
    chunks.push(block);
    used = next;
  }

  if (chunks.length === 0) return null;
  if (omitted > 0) {
    const more = `_+${omitted} more touch(es)_`;
    if (used + 2 + more.length <= maxChars) chunks.push(more);
  }
  return chunks.join("\n\n");
}

export function sessionPostKey(session: LobbyMateSession): string {
  const touchKeyPart = session.touches
    .map((touch) => `${touch.mcUsername.toLowerCase()}\t${touch.lobby}\t${touch.at}`)
    .sort()
    .join(";");
  return [
    session.mcUsername,
    session.currentLobby ?? "",
    session.currentLocation ?? "",
    session.lobbies.join(">"),
    touchKeyPart,
  ].join("|");
}

/**
 * Advance or start a Pit lobby-touch session.
 * Records first co-presence per IGN×lobby with a timestamp.
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
  const incomingTouches: LobbyMateTouch[] =
    lobby == null
      ? []
      : currentMates.map((name) => ({
          mcUsername: name,
          lobby,
          at: input.at,
        }));

  if (!input.previous) {
    const session: LobbyMateSession = {
      accountId: input.accountId,
      mcUsername: input.mcUsername,
      startedAt: input.at,
      currentLobby: lobby,
      currentLocation: location,
      lobbies: lobby ? [lobby] : [],
      touches: incomingTouches,
      discordMessageId: null,
      lastPostedKey: null,
    };
    return { session, shouldPost: true, reason: "started" };
  }

  const lobbies = [...input.previous.lobbies];
  if (lobby && !lobbies.some((row) => row.toLowerCase() === lobby.toLowerCase())) {
    lobbies.push(lobby);
  }
  const touches = mergeLobbyMateTouches(input.previous.touches, incomingTouches);
  const lobbyChanged =
    (input.previous.currentLobby ?? null) !== lobby ||
    (input.previous.currentLocation ?? null) !== location;
  const matesGrew = touches.length > input.previous.touches.length;

  const session: LobbyMateSession = {
    ...input.previous,
    mcUsername: input.mcUsername,
    currentLobby: lobby,
    currentLocation: location,
    lobbies,
    touches,
  };

  if (lobbyChanged && (input.previous.currentLobby ?? null) !== lobby) {
    return { session, shouldPost: true, reason: "lobby" };
  }
  if (matesGrew) {
    return { session, shouldPost: true, reason: "mates" };
  }
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

  const touchesBlock = formatLobbyMateTouchesBlock(session, {
    maxChars: Math.max(200, 2000 - headline.length - 2),
  });
  const content = [headline, touchesBlock].filter(Boolean).join("\n\n").slice(0, 2000);

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "Player", value: session.mcUsername, inline: true },
    {
      name: "Current",
      value: currentBits || (ended ? "left" : "—"),
      inline: true,
    },
    {
      name: "Touches",
      value: String(session.touches.length),
      inline: true,
    },
  ];

  // One embed field per lobby (Discord field limit 25; keep headroom).
  const lobbyOrder = [...session.lobbies];
  for (const touch of session.touches) {
    if (!lobbyOrder.some((lobby) => lobby.toLowerCase() === touch.lobby.toLowerCase())) {
      lobbyOrder.push(touch.lobby);
    }
  }
  for (const lobby of lobbyOrder.slice(0, 20)) {
    const touches = session.touches
      .filter((touch) => touch.lobby.toLowerCase() === lobby.toLowerCase())
      .sort((a, b) => {
        const time = Date.parse(a.at) - Date.parse(b.at);
        if (time !== 0) return time;
        return a.mcUsername.localeCompare(b.mcUsername, undefined, { sensitivity: "base" });
      });
    if (touches.length === 0) continue;
    const lines = touches.map(
      (touch) => `• ${touch.mcUsername} — ${formatTouchClock(touch.at)}`,
    );
    let value = "";
    let omitted = 0;
    for (const line of lines) {
      const next = value ? `${value}\n${line}` : line;
      if (next.length > 1000) {
        omitted = lines.length - value.split("\n").filter(Boolean).length;
        break;
      }
      value = next;
    }
    if (omitted > 0) {
      const more = `• +${omitted} more`;
      if (`${value}\n${more}`.length <= 1000) value = `${value}\n${more}`;
    }
    fields.push({
      name: `${lobby} (${touches.length})`,
      value: value || "_empty_",
    });
  }

  return {
    content,
    embeds: [
      {
        title: headline.slice(0, 256),
        color: ended ? 0x99aab5 : 0x57f287,
        fields,
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

function coerceTouch(value: unknown, fallbackAt: string, fallbackLobby: string | null): LobbyMateTouch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const mcUsername =
    typeof row.mcUsername === "string"
      ? row.mcUsername.trim()
      : typeof row.name === "string"
        ? row.name.trim()
        : "";
  if (!mcUsername) return null;
  const lobby =
    typeof row.lobby === "string" && row.lobby.trim()
      ? row.lobby.trim()
      : fallbackLobby;
  if (!lobby) return null;
  const at =
    typeof row.at === "string" && row.at && !Number.isNaN(Date.parse(row.at))
      ? row.at
      : fallbackAt;
  return { mcUsername, lobby, at };
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
      const startedAt =
        typeof entry.startedAt === "string" && entry.startedAt
          ? entry.startedAt
          : new Date().toISOString();
      const currentLobby = typeof entry.currentLobby === "string" ? entry.currentLobby : null;
      const lobbies = Array.isArray(entry.lobbies)
        ? entry.lobbies.filter(
            (name): name is string => typeof name === "string" && Boolean(name.trim()),
          )
        : [];

      let touches: LobbyMateTouch[] = [];
      if (Array.isArray(entry.touches)) {
        touches = entry.touches
          .map((touch) => coerceTouch(touch, startedAt, currentLobby))
          .filter((touch): touch is LobbyMateTouch => Boolean(touch));
      } else if (Array.isArray(entry.touchedIgns)) {
        // Migrate older flat IGN lists.
        const lobby = currentLobby || lobbies[0] || "unknown";
        touches = entry.touchedIgns
          .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
          .map((name) => ({ mcUsername: name.trim(), lobby, at: startedAt }));
      }
      touches = mergeLobbyMateTouches([], touches);

      sessions.push({
        accountId: entry.accountId.trim(),
        mcUsername: entry.mcUsername.trim(),
        startedAt,
        currentLobby,
        currentLocation:
          typeof entry.currentLocation === "string" ? entry.currentLocation : null,
        lobbies,
        touches,
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
