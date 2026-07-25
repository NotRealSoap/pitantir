import type { Database } from "../client.js";
import { AccountsRepository } from "./repository.js";
import {
  getDiscordWebhookSettings,
  setDiscordWebhookSettings,
  isPresenceOnlyPlayerRule,
  mutePresenceAlertsOnPresenceOnlyRules,
  discordDashboardOnlyPlayerRule,
  ensureForcedDiscordDashboardOnlyRules,
  type DiscordPlayerRule,
} from "./discord-webhook.js";
import { notesIndicate140er } from "./notes-labels.js";
import { HYPIXEL_140ER_INTERVAL_SECONDS } from "@pitantir/shared/inventory";

export type FurryStashEntry = {
  username: string;
  notes: string | null;
  is140er: boolean;
};

export { notesIndicate140er, notesIndicateFurryStash } from "./notes-labels.js";

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

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

function presenceOnlyRule(accountId: string, mcUsername: string): DiscordPlayerRule {
  // 140ers stay on the online roster dashboard(s) via PitPal, but do not post
  // came_online / went_offline / still-online to the alerts channel.
  return discordDashboardOnlyPlayerRule(accountId, mcUsername);
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
 * Accounts whose notes contain "140er" get Discord rules for dashboard only
 * (no online/offline alerts, no inventory / item +/−, no PitPal status).
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
    const patches: { notes?: string; scanIntervalSeconds?: number } = {};
    if (account.notes !== noteLabel) {
      patches.notes = noteLabel;
    }
    if (entry.is140er && account.scanIntervalSeconds < HYPIXEL_140ER_INTERVAL_SECONDS) {
      patches.scanIntervalSeconds = HYPIXEL_140ER_INTERVAL_SECONDS;
    }
    if (Object.keys(patches).length > 0) {
      await repo.update(account.id, patches);
      updated += 1;
    }

    const existing = rulesById.get(account.id);
    if (entry.is140er) {
      const next = presenceOnlyRule(account.id, account.mcUsername);
      rulesById.set(account.id, next);
      marked140er += 1;
    } else if (existing && isPresenceOnlyPlayerRule(existing)) {
      // Was a 140er-only rule; drop override so global defaults apply again.
      rulesById.delete(account.id);
      cleared140er += 1;
    }
  }

  const nextRules = mutePresenceAlertsOnPresenceOnlyRules(
    [...rulesById.values()].sort((a, b) =>
      a.mcUsername.localeCompare(b.mcUsername, undefined, { sensitivity: "base" }),
    ),
  );
  await setDiscordWebhookSettings(db, {
    ...discord,
    playerRules: nextRules,
  });
  // Forced dashboard-only mutes — re-apply after stash sync.
  await ensureForcedDiscordDashboardOnlyRules(db).catch(() => undefined);

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
