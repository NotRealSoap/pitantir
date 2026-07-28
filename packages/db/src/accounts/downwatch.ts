import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";
import { AccountsRepository } from "./repository.js";

export const DOWNWATCH_SETTINGS_KEY = "pitpal_downwatch";

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

export type DownwatchEntry = {
  mcUsername: string;
  accountId: string | null;
  addedAt: string;
  addedBy: string | null;
};

export type DownwatchState = {
  entries: DownwatchEntry[];
  /** Discord message cursor for command polling. */
  lastProcessedMessageId: string | null;
};

const EMPTY: DownwatchState = {
  entries: [],
  lastProcessedMessageId: null,
};

function normalizeUsername(value: string): string | null {
  const trimmed = value.trim();
  if (!USERNAME_RE.test(trimmed)) return null;
  return trimmed;
}

function normalizeState(value: unknown): DownwatchState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY, entries: [] };
  }
  const row = value as Record<string, unknown>;
  const entries: DownwatchEntry[] = [];
  if (Array.isArray(row.entries)) {
    for (const item of row.entries) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const entry = item as Record<string, unknown>;
      const mcUsername =
        typeof entry.mcUsername === "string" ? normalizeUsername(entry.mcUsername) : null;
      if (!mcUsername) continue;
      entries.push({
        mcUsername,
        accountId: typeof entry.accountId === "string" ? entry.accountId : null,
        addedAt:
          typeof entry.addedAt === "string" && entry.addedAt
            ? entry.addedAt
            : new Date().toISOString(),
        addedBy: typeof entry.addedBy === "string" ? entry.addedBy : null,
      });
    }
  }
  // Dedupe by lowercase username; last wins.
  const byName = new Map<string, DownwatchEntry>();
  for (const entry of entries) {
    byName.set(entry.mcUsername.toLowerCase(), entry);
  }
  return {
    entries: [...byName.values()].sort((a, b) =>
      a.mcUsername.localeCompare(b.mcUsername, undefined, { sensitivity: "base" }),
    ),
    lastProcessedMessageId:
      typeof row.lastProcessedMessageId === "string" && row.lastProcessedMessageId.trim()
        ? row.lastProcessedMessageId.trim()
        : null,
  };
}

async function writeState(db: Database, state: DownwatchState): Promise<void> {
  const existing = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, DOWNWATCH_SETTINGS_KEY))
    .limit(1);
  if (existing[0]) {
    await db
      .update(adminSettings)
      .set({ value: state, updatedAt: now() })
      .where(eq(adminSettings.key, DOWNWATCH_SETTINGS_KEY));
    return;
  }
  await db.insert(adminSettings).values({
    key: DOWNWATCH_SETTINGS_KEY,
    value: state,
    updatedAt: now(),
  });
}

export async function getDownwatchState(db: Database): Promise<DownwatchState> {
  const rows = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, DOWNWATCH_SETTINGS_KEY))
    .limit(1);
  return normalizeState(rows[0]?.value);
}

export function isOnDownwatch(
  state: DownwatchState,
  mcUsername: string,
): boolean {
  const key = mcUsername.trim().toLowerCase();
  return state.entries.some((entry) => entry.mcUsername.toLowerCase() === key);
}

export async function listDownwatch(db: Database): Promise<DownwatchEntry[]> {
  return (await getDownwatchState(db)).entries;
}

export async function addDownwatch(
  db: Database,
  mcUsernameRaw: string,
  options?: { addedBy?: string | null },
): Promise<{ entry: DownwatchEntry; created: boolean; promoted: boolean }> {
  const mcUsername = normalizeUsername(mcUsernameRaw);
  if (!mcUsername) {
    throw new Error("Minecraft username must be 3–16 letters, digits, or underscores.");
  }
  const repo = new AccountsRepository(db);
  const ensured = await repo.ensureOnWatchlist({
    mcUsername,
    displayName: mcUsername,
  });
  const state = await getDownwatchState(db);
  const existing = state.entries.find(
    (row) => row.mcUsername.toLowerCase() === mcUsername.toLowerCase(),
  );
  if (existing) {
    const patched: DownwatchEntry = {
      ...existing,
      mcUsername: ensured.account.mcUsername,
      accountId: ensured.account.id,
    };
    const next = {
      ...state,
      entries: state.entries.map((row) =>
        row.mcUsername.toLowerCase() === mcUsername.toLowerCase() ? patched : row,
      ),
    };
    await writeState(db, next);
    return { entry: patched, created: false, promoted: ensured.promoted };
  }

  const entry: DownwatchEntry = {
    mcUsername: ensured.account.mcUsername,
    accountId: ensured.account.id,
    addedAt: new Date().toISOString(),
    addedBy: options?.addedBy ?? null,
  };
  await writeState(db, {
    ...state,
    entries: [...state.entries, entry].sort((a, b) =>
      a.mcUsername.localeCompare(b.mcUsername, undefined, { sensitivity: "base" }),
    ),
  });
  return { entry, created: true, promoted: ensured.promoted };
}

export async function removeDownwatch(
  db: Database,
  mcUsernameRaw: string,
): Promise<{ removed: boolean; mcUsername: string | null }> {
  const mcUsername = normalizeUsername(mcUsernameRaw);
  if (!mcUsername) {
    throw new Error("Minecraft username must be 3–16 letters, digits, or underscores.");
  }
  const state = await getDownwatchState(db);
  const nextEntries = state.entries.filter(
    (row) => row.mcUsername.toLowerCase() !== mcUsername.toLowerCase(),
  );
  if (nextEntries.length === state.entries.length) {
    return { removed: false, mcUsername };
  }
  await writeState(db, { ...state, entries: nextEntries });
  return { removed: true, mcUsername };
}

export async function setDownwatchCursor(
  db: Database,
  lastProcessedMessageId: string | null,
): Promise<void> {
  const state = await getDownwatchState(db);
  await writeState(db, {
    ...state,
    lastProcessedMessageId,
  });
}

/** True when a PitPal status event means the player just entered/transitioned to DOWN. */
export function eventIndicatesWentDown(event: {
  kind: string;
  detail?: string | null;
}): boolean {
  const detail = event.detail ?? "";
  if (event.kind === "pitpal_entered") {
    return /(^|[·\s])DOWN([·\s]|$)/i.test(detail);
  }
  if (event.kind === "pitpal_location") {
    return /→\s*DOWN\b/i.test(detail);
  }
  return false;
}

export type DownwatchCommand =
  | { action: "add"; mcUsername: string }
  | { action: "remove"; mcUsername: string }
  | { action: "list" }
  | { action: "help" };

/**
 * Parse `!downwatch …` / `!dw …` channel commands.
 */
export function parseDownwatchCommand(content: string): DownwatchCommand | null {
  const trimmed = content.trim();
  const match = /^(?:!downwatch|!dw)\b([\s\S]*)$/i.exec(trimmed);
  if (!match) return null;
  const rest = (match[1] ?? "").trim();
  if (!rest || /^help$/i.test(rest) || /^\?$/.test(rest)) {
    return { action: "help" };
  }
  const listMatch = /^(?:list|ls)$/i.exec(rest);
  if (listMatch) return { action: "list" };

  const addMatch = /^(?:add|watch|\+)\s+(\S+)/i.exec(rest);
  if (addMatch?.[1]) {
    return { action: "add", mcUsername: addMatch[1] };
  }
  const removeMatch = /^(?:remove|rm|unwatch|del|delete|-)\s+(\S+)/i.exec(rest);
  if (removeMatch?.[1]) {
    return { action: "remove", mcUsername: removeMatch[1] };
  }
  // Bare `!downwatch Name` → add
  const bare = /^(\S+)$/.exec(rest);
  if (bare?.[1] && !/^(add|remove|list|help)$/i.test(bare[1])) {
    return { action: "add", mcUsername: bare[1] };
  }
  return { action: "help" };
}
