import type { Database } from "../client.js";
import { AccountsRepository } from "./repository.js";
import {
  getDiscordWebhookSettings,
  setDiscordWebhookSettings,
  type DiscordPlayerRule,
  type DiscordWebhookSettings,
} from "./discord-webhook.js";

export type FurryStashEntry = {
  username: string;
  notes: string | null;
  is140er: boolean;
};

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

/** PitPal furry-stash notes that mark presence-only monitoring. */
export function notesIndicate140er(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return /\b140ers?\b/i.test(notes) || /140er/i.test(notes);
}

export function coerceFurryStashEntry(value: unknown): FurryStashEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const usernameRaw =
    typeof row.username === "string"
      ? row.username
      : typeof row.mcUsername === "string"
        ? row.mcUsername
        : typeof row.name === "string"
          ? row.name
          : "";
  const username = usernameRaw.trim();
  if (!USERNAME_RE.test(username)) return null;
  const notes =
    typeof row.notes === "string" && row.notes.trim() ? row.notes.trim() : null;
  const explicit =
    typeof row.is140er === "boolean"
      ? row.is140er
      : typeof row.is140 === "boolean"
        ? row.is140
        : null;
  return {
    username,
    notes,
    is140er: explicit ?? notesIndicate140er(notes),
  };
}

function presenceOnlyRule(
  accountId: string,
  mcUsername: string,
  defaults: DiscordWebhookSettings,
): DiscordPlayerRule {
  return {
    accountId,
    mcUsername,
    notifyCameOnline: defaults.notifyCameOnline,
    notifyWentOffline: true,
    notifyEveryOnlineScan: defaults.notifyEveryOnlineScan,
    notifyItemGainedLost: false,
    notifyInventoryUpdated: false,
    notifyPitpalStatusChanges: false,
  };
}

function isPresenceOnlyRule(rule: DiscordPlayerRule): boolean {
  return (
    rule.notifyItemGainedLost === false &&
    rule.notifyInventoryUpdated === false &&
    rule.notifyPitpalStatusChanges === false
  );
}

export type SyncFurryStashesResult = {
  entryCount: number;
  created: number;
  promoted: number;
  updated: number;
  marked140er: number;
  cleared140er: number;
  observedAt: string;
};

/**
 * Ensure every PitPal furry-stash IGN is on the Hypixel watchlist.
 * Accounts whose notes contain "140er" get Discord rules for dashboard +
 * online/offline only (no inventory updates or item +/−, no PitPal status).
 */
export async function syncFurryStashesWatchlist(
  db: Database,
  input: {
    observedAt?: string | null;
    source?: string | null;
    entries: unknown[];
  },
): Promise<SyncFurryStashesResult> {
  const observedAt =
    input.observedAt && !Number.isNaN(Date.parse(input.observedAt))
      ? new Date(input.observedAt).toISOString()
      : new Date().toISOString();

  const entries = input.entries
    .map(coerceFurryStashEntry)
    .filter((row): row is FurryStashEntry => Boolean(row));

  // Dedupe by lowercase username; last wins.
  const byName = new Map<string, FurryStashEntry>();
  for (const entry of entries) {
    byName.set(entry.username.toLowerCase(), entry);
  }

  const repo = new AccountsRepository(db);
  const discord = await getDiscordWebhookSettings(db);
  const rulesById = new Map(discord.playerRules.map((rule) => [rule.accountId, rule]));

  let created = 0;
  let promoted = 0;
  let updated = 0;
  let marked140er = 0;
  let cleared140er = 0;

  for (const entry of byName.values()) {
    const noteLabel = entry.notes
      ? `furry-stashes: ${entry.notes}`
      : "furry-stashes";
    const ensured = await repo.ensureOnWatchlist({
      mcUsername: entry.username,
      displayName: entry.username,
    });
    if (ensured.created) created += 1;
    if (ensured.promoted) promoted += 1;

    const account = ensured.account;
    if (account.notes !== noteLabel) {
      await repo.update(account.id, { notes: noteLabel });
      updated += 1;
    }

    const existing = rulesById.get(account.id);
    if (entry.is140er) {
      const next = presenceOnlyRule(account.id, account.mcUsername, discord);
      rulesById.set(account.id, next);
      marked140er += 1;
    } else if (existing && isPresenceOnlyRule(existing)) {
      // Was a 140er-only rule; drop override so global defaults apply again.
      rulesById.delete(account.id);
      cleared140er += 1;
    }
  }

  const nextRules = [...rulesById.values()].sort((a, b) =>
    a.mcUsername.localeCompare(b.mcUsername, undefined, { sensitivity: "base" }),
  );
  await setDiscordWebhookSettings(db, {
    ...discord,
    playerRules: nextRules,
  });

  return {
    entryCount: byName.size,
    created,
    promoted,
    updated,
    marked140er,
    cleared140er,
    observedAt,
  };
}
