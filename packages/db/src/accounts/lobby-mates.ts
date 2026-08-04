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
/** Keep watching a lobby after the tracked account leaves it (trade exit window). */
export const LOBBY_MATE_TRAIL_MS = 20_000;

export type PitpalLobbyPlayerRef = {
  name: string;
  lobbyName: string | null;
  location?: string | null;
};

/** Co-presence window for an IGN in a lobby with the watched account. */
export type LobbyMateTouch = {
  mcUsername: string;
  lobby: string;
  firstAt: string;
  lastAt: string;
};

export type TrailingLobbyWatch = {
  lobby: string;
  /** ISO timestamp when trailing observation ends. */
  until: string;
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
  /** True while the watched account is listed in Pit (not merely trailing). */
  inPit: boolean;
  /** Lobbies visited this Pit session, in order. */
  lobbies: string[];
  /** Per IGN×lobby co-presence windows. */
  touches: LobbyMateTouch[];
  /** Lobbies still observed for LOBBY_MATE_TRAIL_MS after leave/hop. */
  trailing: TrailingLobbyWatch[];
  /** Single Discord message id (short notice + .txt attachment). */
  discordMessageIds: string[];
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
    byKey.set(touchKey(touch.mcUsername, touch.lobby), { ...touch });
  }
  for (const touch of incoming) {
    const key = touchKey(touch.mcUsername, touch.lobby);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...touch });
      continue;
    }
    const firstAt =
      Date.parse(touch.firstAt) < Date.parse(prev.firstAt) ? touch.firstAt : prev.firstAt;
    const lastAt =
      Date.parse(touch.lastAt) > Date.parse(prev.lastAt) ? touch.lastAt : prev.lastAt;
    byKey.set(key, {
      mcUsername: prev.mcUsername,
      lobby: prev.lobby,
      firstAt,
      lastAt,
    });
  }
  return [...byKey.values()];
}

/** Extend lastAt for existing touches still present in a lobby (trailing window). */
export function refreshTouchesStillInLobby(
  touches: LobbyMateTouch[],
  lobby: string,
  presentNames: string[],
  at: string,
): LobbyMateTouch[] {
  const present = new Set(presentNames.map((name) => name.toLowerCase()));
  return touches.map((touch) => {
    if (touch.lobby.toLowerCase() !== lobby.toLowerCase()) return touch;
    if (!present.has(touch.mcUsername.toLowerCase())) return touch;
    if (Date.parse(at) <= Date.parse(touch.lastAt)) return touch;
    return { ...touch, lastAt: at };
  });
}

export function formatTouchClock(at: string): string {
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return at;
  return new Date(ms).toISOString().slice(11, 19) + " UTC";
}

export function formatTouchRange(firstAt: string, lastAt: string): string {
  const start = formatTouchClock(firstAt);
  const end = formatTouchClock(lastAt);
  if (start === end) return start;
  return `${start} – ${end}`;
}

export function pruneTrailing(
  trailing: TrailingLobbyWatch[],
  nowIso: string,
): TrailingLobbyWatch[] {
  const nowMs = Date.parse(nowIso);
  return trailing.filter((row) => Date.parse(row.until) > nowMs);
}

export function startTrailingLobby(
  trailing: TrailingLobbyWatch[],
  lobby: string | null | undefined,
  at: string,
  trailMs = LOBBY_MATE_TRAIL_MS,
): TrailingLobbyWatch[] {
  const name = lobby?.trim();
  if (!name) return trailing;
  const until = new Date(Date.parse(at) + trailMs).toISOString();
  const next = trailing.filter((row) => row.lobby.toLowerCase() !== name.toLowerCase());
  next.push({ lobby: name, until });
  return next;
}

export type LobbyMateLobbySection = {
  lobby: string;
  total: number;
  lines: string[];
};

export function buildLobbyMateLobbySections(
  session: Pick<LobbyMateSession, "lobbies" | "touches">,
): LobbyMateLobbySection[] {
  if (session.touches.length === 0) return [];
  const lobbyOrder = [...session.lobbies];
  for (const touch of session.touches) {
    if (!lobbyOrder.some((lobby) => lobby.toLowerCase() === touch.lobby.toLowerCase())) {
      lobbyOrder.push(touch.lobby);
    }
  }

  const sections: LobbyMateLobbySection[] = [];
  for (const lobby of lobbyOrder) {
    const touches = session.touches
      .filter((touch) => touch.lobby.toLowerCase() === lobby.toLowerCase())
      .sort((a, b) => {
        const time = Date.parse(a.firstAt) - Date.parse(b.firstAt);
        if (time !== 0) return time;
        return a.mcUsername.localeCompare(b.mcUsername, undefined, { sensitivity: "base" });
      });
    if (touches.length === 0) continue;
    sections.push({
      lobby,
      total: touches.length,
      lines: touches.map(
        (touch) =>
          `• ${touch.mcUsername} — ${formatTouchRange(touch.firstAt, touch.lastAt)}`,
      ),
    });
  }
  return sections;
}

/** Full plain-text log for the .txt attachment. */
export function buildLobbyMateTxtLog(
  session: LobbyMateSession,
  options?: { ended?: boolean; at?: string },
): string {
  const ended = options?.ended === true;
  const at = options?.at ?? new Date().toISOString();
  const currentBits = [session.currentLobby, session.currentLocation].filter(Boolean).join(" · ");
  const lines = [
    `${session.mcUsername} · lobby mates session`,
    `Status: ${ended ? "closed" : session.inPit ? "active" : "trailing"}`,
    `Started: ${session.startedAt}`,
    `Updated: ${at}`,
    currentBits ? `Current: ${currentBits}` : "Current: —",
    `Touches: ${session.touches.length}`,
    session.lobbies.length ? `Lobbies: ${session.lobbies.join(" → ")}` : null,
    "",
  ].filter((row): row is string => row != null);

  for (const section of buildLobbyMateLobbySections(session)) {
    lines.push(`${section.lobby} (${section.total})`);
    lines.push(...section.lines);
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function lobbyMateAttachmentFilename(mcUsername: string, at: string): string {
  const safeName = mcUsername.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 16) || "player";
  const stamp = at.replace(/[:.]/g, "-");
  return `${safeName}_lobby-mates_${stamp}.txt`;
}

export function sessionPostKey(session: LobbyMateSession): string {
  const touchKeyPart = session.touches
    .map(
      (touch) =>
        `${touch.mcUsername.toLowerCase()}\t${touch.lobby}\t${touch.firstAt}\t${touch.lastAt}`,
    )
    .sort()
    .join(";");
  const trailKey = session.trailing
    .map((row) => `${row.lobby}:${row.until}`)
    .sort()
    .join(";");
  return [
    session.mcUsername,
    session.inPit ? "in" : "out",
    session.currentLobby ?? "",
    session.currentLocation ?? "",
    session.lobbies.join(">"),
    trailKey,
    touchKeyPart,
  ].join("|");
}

/**
 * Advance or start a Pit lobby-touch session.
 * - While in a lobby: record/extend co-presence windows.
 * - On lobby hop / leave Pit: trail the previous lobby for 20s.
 */
export function applyLobbyMateTouch(input: {
  previous: LobbyMateSession | null;
  accountId: string;
  mcUsername: string;
  lobby: string | null;
  location: string | null;
  currentMates: string[];
  /** Names currently in lobbies being trailed (lobby → names). */
  trailingMatesByLobby?: Record<string, string[]>;
  at: string;
  inPit: boolean;
}): { session: LobbyMateSession; shouldPost: boolean; reason: string; ended: boolean } {
  const at = input.at;
  const lobby = input.lobby?.trim() || null;
  const location = input.location?.trim() || null;
  const currentMates = uniqueSortedNames(input.currentMates);

  if (!input.previous) {
    if (!input.inPit || !lobby) {
      return {
        session: {
          accountId: input.accountId,
          mcUsername: input.mcUsername,
          startedAt: at,
          currentLobby: null,
          currentLocation: null,
          inPit: false,
          lobbies: [],
          touches: [],
          trailing: [],
          discordMessageIds: [],
          lastPostedKey: null,
        },
        shouldPost: false,
        reason: "skip",
        ended: false,
      };
    }
    const touches = currentMates.map((name) => ({
      mcUsername: name,
      lobby,
      firstAt: at,
      lastAt: at,
    }));
    return {
      session: {
        accountId: input.accountId,
        mcUsername: input.mcUsername,
        startedAt: at,
        currentLobby: lobby,
        currentLocation: location,
        inPit: true,
        lobbies: [lobby],
        touches,
        trailing: [],
        discordMessageIds: [],
        lastPostedKey: null,
      },
      shouldPost: true,
      reason: "started",
      ended: false,
    };
  }

  let trailing = pruneTrailing(input.previous.trailing, at);
  let touches = [...input.previous.touches];
  let lobbies = [...input.previous.lobbies];
  const prevLobby = input.previous.currentLobby;
  const lobbyHopped =
    input.inPit &&
    Boolean(lobby) &&
    Boolean(prevLobby) &&
    (prevLobby ?? "").toLowerCase() !== (lobby ?? "").toLowerCase();
  const leftPit = input.previous.inPit && !input.inPit;

  if (lobbyHopped || leftPit) {
    trailing = startTrailingLobby(trailing, prevLobby, at);
  }

  if (input.inPit && lobby) {
    if (!lobbies.some((row) => row.toLowerCase() === lobby.toLowerCase())) {
      lobbies.push(lobby);
    }
    const incoming = currentMates.map((name) => ({
      mcUsername: name,
      lobby,
      firstAt: at,
      lastAt: at,
    }));
    touches = mergeLobbyMateTouches(touches, incoming);
  }

  // Trailing lobbies: extend lastAt for anyone still there (catch near-simultaneous exits).
  for (const watch of trailing) {
    const present =
      input.trailingMatesByLobby?.[watch.lobby] ??
      input.trailingMatesByLobby?.[watch.lobby.toLowerCase()] ??
      [];
    // Also accept lookup by exact key from caller.
    const names = uniqueSortedNames(present);
    touches = refreshTouchesStillInLobby(touches, watch.lobby, names, at);
  }

  trailing = pruneTrailing(trailing, at);
  const ended = !input.inPit && trailing.length === 0;
  const session: LobbyMateSession = {
    ...input.previous,
    mcUsername: input.mcUsername,
    currentLobby: input.inPit ? lobby : null,
    currentLocation: input.inPit ? location : null,
    inPit: input.inPit,
    lobbies,
    touches,
    trailing,
  };

  const matesGrew = session.touches.length > input.previous.touches.length;
  const lastExtended = session.touches.some((touch) => {
    const prev = input.previous!.touches.find(
      (row) => touchKey(row.mcUsername, row.lobby) === touchKey(touch.mcUsername, touch.lobby),
    );
    return !prev || prev.lastAt !== touch.lastAt || prev.firstAt !== touch.firstAt;
  });
  const lobbyChanged =
    (input.previous.currentLobby ?? null) !== session.currentLobby ||
    (input.previous.currentLocation ?? null) !== session.currentLocation ||
    input.previous.inPit !== session.inPit;

  let reason = "noop";
  let shouldPost = false;
  if (!input.previous.inPit && input.inPit) {
    reason = "started";
    shouldPost = true;
  } else if (ended) {
    reason = "ended";
    shouldPost = true;
  } else if (lobbyHopped || leftPit) {
    reason = lobbyHopped ? "lobby" : "left";
    shouldPost = true;
  } else if (matesGrew) {
    reason = "mates";
    shouldPost = true;
  } else if (lobbyChanged) {
    reason = "lobby";
    shouldPost = true;
  } else if (lastExtended) {
    // Keep extending first/last windows in state; don't spam Discord every poll.
    reason = "window";
    shouldPost = false;
  }

  return { session, shouldPost, reason, ended };
}

export function buildLobbyMateDiscordNotice(
  session: LobbyMateSession,
  options?: { ended?: boolean; filename?: string },
): { content: string; embeds: Array<Record<string, unknown>>; key: string } {
  const ended = options?.ended === true;
  const currentBits = [session.currentLobby, session.currentLocation].filter(Boolean).join(" · ");
  const status = ended ? "closed" : session.inPit ? "active" : "trailing 20s";
  const filename = options?.filename ?? `${session.mcUsername}_lobby-mates.txt`;
  const content = [
    `\`${session.mcUsername}\` · lobby mates · **${status}**`,
    currentBits ? `Lobby: \`${currentBits}\`` : null,
    `Touches: **${session.touches.length}** · file: \`${filename}\``,
    "_Delete this Discord message to clear the log._",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);

  return {
    content,
    embeds: [
      {
        title: `${session.mcUsername} · lobby mates`.slice(0, 256),
        description: [
          `Status: ${status}`,
          currentBits ? `Current: ${currentBits}` : null,
          `Touches: ${session.touches.length}`,
          `Attachment: ${filename}`,
          "Full lobby/time windows are in the .txt — delete this message to remove the log.",
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 4096),
        color: ended ? 0x99aab5 : 0x57f287,
        timestamp: new Date().toISOString(),
        footer: { text: "Pitantir lobby mates · .txt attachment" },
      },
    ],
    key: `${ended ? "ended|" : ""}${sessionPostKey(session)}`,
  };
}

function coerceTouch(
  value: unknown,
  fallbackAt: string,
  fallbackLobby: string | null,
): LobbyMateTouch | null {
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
  const firstAt =
    typeof row.firstAt === "string" && row.firstAt && !Number.isNaN(Date.parse(row.firstAt))
      ? row.firstAt
      : typeof row.at === "string" && row.at && !Number.isNaN(Date.parse(row.at))
        ? row.at
        : fallbackAt;
  const lastAt =
    typeof row.lastAt === "string" && row.lastAt && !Number.isNaN(Date.parse(row.lastAt))
      ? row.lastAt
      : firstAt;
  return { mcUsername, lobby, firstAt, lastAt };
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
        const lobby = currentLobby || lobbies[0] || "unknown";
        touches = entry.touchedIgns
          .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
          .map((name) => ({
            mcUsername: name.trim(),
            lobby,
            firstAt: startedAt,
            lastAt: startedAt,
          }));
      }
      touches = mergeLobbyMateTouches([], touches);

      const trailing: TrailingLobbyWatch[] = [];
      if (Array.isArray(entry.trailing)) {
        for (const itemTrail of entry.trailing) {
          if (!itemTrail || typeof itemTrail !== "object" || Array.isArray(itemTrail)) continue;
          const trail = itemTrail as Record<string, unknown>;
          if (typeof trail.lobby !== "string" || !trail.lobby.trim()) continue;
          if (typeof trail.until !== "string" || Number.isNaN(Date.parse(trail.until))) continue;
          trailing.push({ lobby: trail.lobby.trim(), until: trail.until });
        }
      }

      const messageIds: string[] = [];
      if (Array.isArray(entry.discordMessageIds)) {
        for (const id of entry.discordMessageIds) {
          if (typeof id === "string" && id.trim()) messageIds.push(id.trim());
        }
      } else if (
        typeof entry.discordMessageId === "string" &&
        entry.discordMessageId.trim()
      ) {
        messageIds.push(entry.discordMessageId.trim());
      }

      sessions.push({
        accountId: entry.accountId.trim(),
        mcUsername: entry.mcUsername.trim(),
        startedAt,
        currentLobby,
        currentLocation:
          typeof entry.currentLocation === "string" ? entry.currentLocation : null,
        inPit: typeof entry.inPit === "boolean" ? entry.inPit : Boolean(currentLobby),
        lobbies,
        touches,
        trailing,
        discordMessageIds: messageIds,
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
    updatedAt: stamp,
  });
}

async function discordFetch(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(12_000),
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

async function deleteDiscordMessage(webhookUrl: string, messageId: string): Promise<void> {
  await discordFetch(`${webhookUrl}/messages/${messageId}`, {
    method: "DELETE",
  }).catch(() => undefined);
}

async function postLobbyMateWithTxt(
  webhookUrl: string,
  notice: { content: string; embeds: Array<Record<string, unknown>> },
  filename: string,
  txtBody: string,
): Promise<string | null> {
  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify({
      content: notice.content,
      embeds: notice.embeds,
    }),
  );
  form.append(
    "files[0]",
    new Blob([txtBody], { type: "text/plain; charset=utf-8" }),
    filename,
  );

  const posted = await discordFetch(`${webhookUrl}?wait=true`, {
    method: "POST",
    body: form,
  });
  if (!posted.ok) return null;
  if (
    posted.json &&
    typeof posted.json === "object" &&
    typeof (posted.json as { id?: unknown }).id === "string"
  ) {
    return (posted.json as { id: string }).id;
  }
  return null;
}

/**
 * Replace prior Discord message(s) with one short notice + .txt attachment.
 * Deleting that Discord message clears the whole log.
 */
async function upsertSessionTxtMessage(
  webhookUrl: string,
  session: LobbyMateSession,
  options?: { ended?: boolean; at?: string },
): Promise<LobbyMateSession> {
  const at = options?.at ?? new Date().toISOString();
  const ended = options?.ended === true;
  const filename = lobbyMateAttachmentFilename(session.mcUsername, at);
  const notice = buildLobbyMateDiscordNotice(session, { ended, filename });
  if (session.lastPostedKey === notice.key && session.discordMessageIds.length === 1) {
    return session;
  }

  const txt = buildLobbyMateTxtLog(session, { ended, at });
  const messageId = await postLobbyMateWithTxt(webhookUrl, notice, filename, txt);
  if (!messageId) return session;

  for (const oldId of session.discordMessageIds) {
    if (oldId !== messageId) await deleteDiscordMessage(webhookUrl, oldId);
  }

  return {
    ...session,
    discordMessageIds: [messageId],
    lastPostedKey: notice.key,
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
 * Posts a short Discord notice + .txt attachment (easy to identify/delete).
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

  const eligible = input.watchlist.filter((account) => {
    if (!shouldTrackLobbyMates(account)) return false;
    if (isForcedDiscordDashboardOnlyUsername(account.mcUsername)) return false;
    const flags = resolveNotifyFlagsForEvent(settings, {
      accountId: account.id,
      mcUsername: account.mcUsername,
    });
    return flags.notifyPitpalStatusChanges;
  });

  const eligibleIds = new Set(eligible.map((account) => account.id));

  for (const account of eligible) {
    const hit = byName.get(account.mcUsername.toLowerCase()) ?? null;
    const previous = previousById.get(account.id) ?? null;
    previousById.delete(account.id);

    const trailingMatesByLobby: Record<string, string[]> = {};
    for (const watch of previous?.trailing ?? []) {
      trailingMatesByLobby[watch.lobby] = listLobbyMateNames(input.players, watch.lobby);
    }
    // If they just left / hopped, also seed previous lobby from this snapshot.
    if (previous?.currentLobby && (!hit || hit.lobbyName !== previous.currentLobby)) {
      trailingMatesByLobby[previous.currentLobby] = listLobbyMateNames(
        input.players,
        previous.currentLobby,
      );
    }

    const applied = applyLobbyMateTouch({
      previous,
      accountId: account.id,
      mcUsername: account.mcUsername,
      lobby: hit?.lobbyName ?? null,
      location: hit?.location ?? null,
      currentMates: hit ? listLobbyMateNames(input.players, hit.lobbyName) : [],
      trailingMatesByLobby,
      at: input.observedAt,
      inPit: Boolean(hit),
    });

    if (applied.reason === "skip" && !previous) continue;

    let session = applied.session;
    if (applied.ended) {
      session = await upsertSessionTxtMessage(webhookUrl, session, {
        ended: true,
        at: input.observedAt,
      });
      closed += 1;
      posted += 1;
      continue;
    }

    if (applied.shouldPost || !session.discordMessageIds.length) {
      session = await upsertSessionTxtMessage(webhookUrl, session, {
        at: input.observedAt,
      });
      posted += 1;
    }
    nextSessions.push(session);
  }

  // Close leftover sessions (no longer eligible / removed from watchlist).
  for (const leftover of previousById.values()) {
    if (eligibleIds.has(leftover.accountId)) continue;
    await upsertSessionTxtMessage(webhookUrl, leftover, {
      ended: true,
      at: input.observedAt,
    }).catch(() => leftover);
    closed += 1;
    posted += 1;
  }

  await saveLobbyMateSessions(db, { sessions: nextSessions });
  return { activeSessions: nextSessions.length, posted, closed };
}
