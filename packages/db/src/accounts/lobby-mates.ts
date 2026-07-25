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
  /** Sticky Discord message chain (page 1, page 2, …). */
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

export type LobbyMateLobbySection = {
  lobby: string;
  total: number;
  lines: string[];
};

/** Group touches by lobby (session order), players by first-seen time then name. */
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
        const time = Date.parse(a.at) - Date.parse(b.at);
        if (time !== 0) return time;
        return a.mcUsername.localeCompare(b.mcUsername, undefined, { sensitivity: "base" });
      });
    if (touches.length === 0) continue;
    sections.push({
      lobby,
      total: touches.length,
      lines: touches.map(
        (touch) => `• ${touch.mcUsername} — ${formatTouchClock(touch.at)}`,
      ),
    });
  }
  return sections;
}

/**
 * Split lobby sections into Discord-sized content pages.
 * Never drops touches — overflow becomes page 2+, page 3+, etc.
 */
export function paginateLobbyMateContent(
  headline: string,
  sections: LobbyMateLobbySection[],
  options?: { maxChars?: number },
): string[] {
  const maxChars = options?.maxChars ?? 1900;
  const pages: string[] = [];
  let currentParts: string[] = [];
  let used = 0;

  const pageBudget = (pageIndex: number): { prefix: string; budget: number } => {
    // Reserve room for "page X/Y" once we know Y; use a conservative placeholder.
    const prefix =
      pageIndex === 0
        ? headline
        : `${headline.split(" · ")[0] ?? headline} · lobby mates (cont.)`;
    const reserve = 24; // "\n\n_page 12/12_"
    return { prefix, budget: Math.max(200, maxChars - prefix.length - reserve) };
  };

  const flush = () => {
    if (currentParts.length === 0 && pages.length > 0) return;
    const pageIndex = pages.length;
    const { prefix } = pageBudget(pageIndex);
    const body = currentParts.join("\n\n");
    pages.push(body ? `${prefix}\n\n${body}` : prefix);
    currentParts = [];
    used = 0;
  };

  let pageIndex = 0;
  let { budget } = pageBudget(pageIndex);

  for (const section of sections) {
    let lineOffset = 0;
    while (lineOffset < section.lines.length) {
      const continued = lineOffset > 0;
      const header = continued
        ? `**${section.lobby} (${section.total}) · cont.**`
        : `**${section.lobby} (${section.total})**`;
      const available = budget - used - (used > 0 ? 2 : 0) - header.length - 1;
      if (available < 20) {
        flush();
        pageIndex = pages.length;
        budget = pageBudget(pageIndex).budget;
        used = 0;
        continue;
      }

      const chunkLines: string[] = [];
      let chunkUsed = 0;
      while (lineOffset + chunkLines.length < section.lines.length) {
        const line = section.lines[lineOffset + chunkLines.length]!;
        const next = chunkUsed === 0 ? line.length : chunkUsed + 1 + line.length;
        if (next > available) break;
        chunkLines.push(line);
        chunkUsed = next;
      }

      if (chunkLines.length === 0) {
        // Line alone exceeds remaining budget — start a fresh page.
        if (used > 0) {
          flush();
          pageIndex = pages.length;
          budget = pageBudget(pageIndex).budget;
          used = 0;
          continue;
        }
        // Page is empty and still too tight — take the line anyway (Discord max).
        chunkLines.push(section.lines[lineOffset]!);
        lineOffset += 1;
      } else {
        lineOffset += chunkLines.length;
      }

      const block = [header, ...chunkLines].join("\n");
      if (used === 0) {
        currentParts = [block];
        used = block.length;
      } else {
        currentParts.push(block);
        used += 2 + block.length;
      }

      if (lineOffset < section.lines.length) {
        flush();
        pageIndex = pages.length;
        budget = pageBudget(pageIndex).budget;
        used = 0;
      }
    }
  }

  if (currentParts.length > 0 || pages.length === 0) flush();

  if (pages.length <= 1) return pages;
  return pages.map((page, index) =>
    `${page}\n\n_page ${index + 1}/${pages.length}_`.slice(0, maxChars),
  );
}

/** @deprecated Prefer paginateLobbyMateContent — kept for older call sites/tests. */
export function formatLobbyMateTouchesBlock(
  session: Pick<LobbyMateSession, "lobbies" | "touches">,
  options?: { maxChars?: number },
): string | null {
  const sections = buildLobbyMateLobbySections(session);
  if (sections.length === 0) return null;
  const pages = paginateLobbyMateContent("Session", sections, options);
  return pages[0] ?? null;
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
      discordMessageIds: [],
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

export function buildLobbyMateSessionPages(
  session: LobbyMateSession,
  options?: { ended?: boolean; at?: string },
): {
  pages: Array<{ content: string; embeds: Array<Record<string, unknown>> }>;
  key: string;
} {
  const ended = options?.ended === true;
  const at = options?.at ?? new Date().toISOString();
  const currentBits = [session.currentLobby, session.currentLocation].filter(Boolean).join(" · ");
  const headline = ended
    ? `${session.mcUsername} left Pit · session closed`
    : currentBits
      ? `${session.mcUsername} entered Pit · ${currentBits}`
      : `${session.mcUsername} entered Pit`;

  const sections = buildLobbyMateLobbySections(session);
  const contents = paginateLobbyMateContent(headline, sections, { maxChars: 1900 });
  const color = ended ? 0x99aab5 : 0x57f287;
  const footer = ended
    ? "Pitantir lobby mates · session closed"
    : "Pitantir lobby mates · updated while in Pit";

  const pages = contents.map((content, index) => ({
    content,
    embeds: [
      {
        title: (index === 0 ? headline : `${session.mcUsername} · lobby mates`).slice(0, 256),
        description: content.slice(0, 4096),
        color,
        timestamp: at,
        footer: {
          text:
            contents.length > 1
              ? `${footer} · page ${index + 1}/${contents.length}`
              : footer,
        },
      },
    ],
  }));

  return {
    pages,
    key: `${ended ? "ended|" : ""}${sessionPostKey(session)}`,
  };
}

/** First page only — useful for tests / simple previews. */
export function buildLobbyMateSessionPayload(
  session: LobbyMateSession,
  options?: { ended?: boolean; at?: string },
): { content: string; embeds: Array<Record<string, unknown>>; key: string } {
  const built = buildLobbyMateSessionPages(session, options);
  const first = built.pages[0] ?? {
    content: session.mcUsername,
    embeds: [],
  };
  return { ...first, key: built.key };
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
        lobbies,
        touches,
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

async function deleteDiscordMessage(webhookUrl: string, messageId: string): Promise<void> {
  await discordFetch(`${webhookUrl}/messages/${messageId}`, {
    method: "DELETE",
  }).catch(() => undefined);
}

async function upsertSessionPages(
  webhookUrl: string,
  session: LobbyMateSession,
  built: {
    pages: Array<{ content: string; embeds: Array<Record<string, unknown>> }>;
    key: string;
  },
): Promise<LobbyMateSession> {
  if (
    session.lastPostedKey === built.key &&
    session.discordMessageIds.length === built.pages.length &&
    session.discordMessageIds.length > 0
  ) {
    return session;
  }

  const nextIds: string[] = [];
  for (let index = 0; index < built.pages.length; index += 1) {
    const page = built.pages[index]!;
    const existingId = session.discordMessageIds[index] ?? null;
    if (existingId) {
      const edited = await discordFetch(`${webhookUrl}/messages/${existingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: page.content,
          embeds: page.embeds,
        }),
      });
      if (edited.ok) {
        nextIds.push(existingId);
        continue;
      }
    }
    const posted = await discordFetch(`${webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: page.content,
        embeds: page.embeds,
      }),
    });
    if (!posted.ok) {
      // Keep whatever we have so far; don't wipe older pages.
      return {
        ...session,
        discordMessageIds: nextIds.length > 0 ? nextIds : session.discordMessageIds,
      };
    }
    const messageId =
      posted.json &&
      typeof posted.json === "object" &&
      typeof (posted.json as { id?: unknown }).id === "string"
        ? (posted.json as { id: string }).id
        : null;
    if (messageId) nextIds.push(messageId);
  }

  // Drop surplus continuation messages when the list shrinks.
  for (const leftover of session.discordMessageIds.slice(nextIds.length)) {
    await deleteDiscordMessage(webhookUrl, leftover);
  }

  return {
    ...session,
    discordMessageIds: nextIds,
    lastPostedKey: built.key,
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
        const built = buildLobbyMateSessionPages(previous, {
          ended: true,
          at: input.observedAt,
        });
        await upsertSessionPages(webhookUrl, previous, built).catch(() => previous);
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
      const built = buildLobbyMateSessionPages(session, { at: input.observedAt });
      session = await upsertSessionPages(webhookUrl, session, built);
      posted += 1;
    }
    nextSessions.push(session);
  }

  for (const leftover of previousById.values()) {
    if (nextSessions.some((session) => session.accountId === leftover.accountId)) continue;
    if (input.watchlist.some((account) => account.id === leftover.accountId)) continue;
    const built = buildLobbyMateSessionPages(leftover, {
      ended: true,
      at: input.observedAt,
    });
    await upsertSessionPages(webhookUrl, leftover, built).catch(() => leftover);
    closed += 1;
    posted += 1;
  }

  await saveLobbyMateSessions(db, { sessions: nextSessions });
  return { activeSessions: nextSessions.length, posted, closed };
}
