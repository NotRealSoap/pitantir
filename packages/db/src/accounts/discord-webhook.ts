import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";
import {
  describeLiveSignal,
  formatInventoryChangeLabel,
  type InventoryChangeItem,
} from "@pitantir/shared/live-signal-copy";
import type { LiveEventKind } from "./live-events.js";
import { AccountsRepository } from "./repository.js";

export const DISCORD_WEBHOOK_SETTINGS_KEY = "discord_webhook";

export type DiscordPlayerNotifyFlags = {
  notifyCameOnline: boolean;
  notifyWentOffline: boolean;
  notifyEveryOnlineScan: boolean;
  /** Mystics gained or lost (nonce added/removed). */
  notifyItemGainedLost: boolean;
  /** Same mystic updated (lives/enchants/slot) without gain/loss. */
  notifyInventoryUpdated: boolean;
  /** PitPal lobby SPAWN/DOWN/OTHER/lobby transitions (append-only channel). */
  notifyPitpalStatusChanges: boolean;
};

export type DiscordPlayerRule = DiscordPlayerNotifyFlags & {
  accountId: string;
  mcUsername: string;
};

export type DiscordWebhookSettings = DiscordPlayerNotifyFlags & {
  /** Online/offline alerts + online roster dashboard. */
  presenceWebhookUrl: string | null;
  /** Same-nonce inventory updates (lives/enchants/slot). */
  inventoryWebhookUrl: string | null;
  /** Item additions/subtractions (gained/lost). */
  itemMovesWebhookUrl: string | null;
  /**
   * PitPal lobby status changes (SPAWN/DOWN/OTHER, lobby hops).
   * Messages are append-only — never deleted by the dashboard refresher.
   */
  pitpalStatusWebhookUrl: string | null;
  onlineDashboardEnabled: boolean;
  onlineDashboardMessageId: string | null;
  onlineDashboardRosterKey: string | null;
  /** Per-watchlist-player overrides (missing player → global defaults). */
  playerRules: DiscordPlayerRule[];
};

export type DiscordNotifyEvent = {
  kind: LiveEventKind | string;
  accountId?: string | null;
  mcUsername: string;
  detail?: string | null;
  changes?: InventoryChangeItem[] | null;
  at?: string | null;
};

export type OnlineRosterEntry = {
  mcUsername: string;
  sessionGame?: string | null;
  seenAt?: string | Date | null;
  lobby?: string | null;
  location?: string | null;
  armorType?: string | null;
  killStreak?: number | null;
};

const DEFAULT_FLAGS: DiscordPlayerNotifyFlags = {
  notifyCameOnline: true,
  notifyWentOffline: false,
  notifyEveryOnlineScan: true,
  notifyItemGainedLost: true,
  notifyInventoryUpdated: false,
  notifyPitpalStatusChanges: true,
};

const DEFAULT_SETTINGS: DiscordWebhookSettings = {
  presenceWebhookUrl: null,
  inventoryWebhookUrl: null,
  itemMovesWebhookUrl: null,
  pitpalStatusWebhookUrl: null,
  ...DEFAULT_FLAGS,
  onlineDashboardEnabled: true,
  onlineDashboardMessageId: null,
  onlineDashboardRosterKey: null,
  playerRules: [],
};

const DISCORD_WEBHOOK_RE =
  /^https:\/\/((?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/i;

export function isDiscordWebhookUrl(value: string): boolean {
  return DISCORD_WEBHOOK_RE.test(value.trim());
}

export function maskDiscordWebhookUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  const parts = trimmed.split("/");
  const token = parts[parts.length - 1] ?? "";
  if (token.length < 8) return "configured";
  const maskedToken = `${token.slice(0, 4)}…${token.slice(-4)}`;
  return [...parts.slice(0, -1), maskedToken].join("/");
}

function readUrl(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePlayerRule(value: unknown): DiscordPlayerRule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.accountId !== "string" || !row.accountId.trim()) return null;
  if (typeof row.mcUsername !== "string" || !row.mcUsername.trim()) return null;
  return {
    accountId: row.accountId.trim(),
    mcUsername: row.mcUsername.trim(),
    notifyCameOnline: readBool(row.notifyCameOnline, DEFAULT_FLAGS.notifyCameOnline),
    notifyWentOffline: readBool(row.notifyWentOffline, DEFAULT_FLAGS.notifyWentOffline),
    notifyEveryOnlineScan: readBool(row.notifyEveryOnlineScan, DEFAULT_FLAGS.notifyEveryOnlineScan),
    notifyItemGainedLost: readBool(row.notifyItemGainedLost, DEFAULT_FLAGS.notifyItemGainedLost),
    notifyInventoryUpdated: readBool(
      row.notifyInventoryUpdated,
      DEFAULT_FLAGS.notifyInventoryUpdated,
    ),
    notifyPitpalStatusChanges: readBool(
      row.notifyPitpalStatusChanges,
      DEFAULT_FLAGS.notifyPitpalStatusChanges,
    ),
  };
}

export function normalizeDiscordWebhookSettings(value: unknown): DiscordWebhookSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS, playerRules: [] };
  }
  const row = value as Record<string, unknown>;
  const legacy = readUrl(row.webhookUrl);
  const presenceWebhookUrl = readUrl(row.presenceWebhookUrl) ?? legacy;
  const inventoryWebhookUrl = readUrl(row.inventoryWebhookUrl);
  const itemMovesWebhookUrl = readUrl(row.itemMovesWebhookUrl);
  const pitpalStatusWebhookUrl = readUrl(row.pitpalStatusWebhookUrl);

  // Migrate old single inventory toggle into the two new flags when present.
  const legacyInventory =
    typeof row.notifyInventoryChanged === "boolean" ? row.notifyInventoryChanged : null;

  let playerRules = Array.isArray(row.playerRules)
    ? row.playerRules.map(normalizePlayerRule).filter((rule): rule is DiscordPlayerRule => Boolean(rule))
    : [];

  const notifyPitpalStatusChanges = readBool(
    row.notifyPitpalStatusChanges,
    DEFAULT_FLAGS.notifyPitpalStatusChanges,
  );
  // Older saves used Boolean(undefined) → false on every custom rule; repair that.
  if (
    notifyPitpalStatusChanges &&
    playerRules.length > 0 &&
    playerRules.every((rule) => rule.notifyPitpalStatusChanges === false)
  ) {
    playerRules = playerRules.map((rule) => ({ ...rule, notifyPitpalStatusChanges: true }));
  }

  return {
    presenceWebhookUrl,
    inventoryWebhookUrl,
    itemMovesWebhookUrl,
    pitpalStatusWebhookUrl,
    notifyCameOnline: readBool(row.notifyCameOnline, DEFAULT_FLAGS.notifyCameOnline),
    notifyWentOffline: readBool(row.notifyWentOffline, DEFAULT_FLAGS.notifyWentOffline),
    notifyEveryOnlineScan: readBool(row.notifyEveryOnlineScan, DEFAULT_FLAGS.notifyEveryOnlineScan),
    notifyItemGainedLost: readBool(
      row.notifyItemGainedLost,
      legacyInventory ?? DEFAULT_FLAGS.notifyItemGainedLost,
    ),
    notifyInventoryUpdated: readBool(
      row.notifyInventoryUpdated,
      legacyInventory ?? DEFAULT_FLAGS.notifyInventoryUpdated,
    ),
    notifyPitpalStatusChanges,
    onlineDashboardEnabled: readBool(row.onlineDashboardEnabled, true),
    onlineDashboardMessageId:
      typeof row.onlineDashboardMessageId === "string" && row.onlineDashboardMessageId.trim()
        ? row.onlineDashboardMessageId.trim()
        : null,
    onlineDashboardRosterKey:
      typeof row.onlineDashboardRosterKey === "string" ? row.onlineDashboardRosterKey : null,
    playerRules,
  };
}

export async function getDiscordWebhookSettings(
  db: Database,
): Promise<DiscordWebhookSettings> {
  const rows = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, DISCORD_WEBHOOK_SETTINGS_KEY))
    .limit(1);
  return normalizeDiscordWebhookSettings(rows[0]?.value);
}

function assertOptionalWebhook(url: string | null, label: string): void {
  if (url && !isDiscordWebhookUrl(url)) {
    throw new Error(`${label} must be a Discord webhook URL.`);
  }
}

export async function setDiscordWebhookSettings(
  db: Database,
  settings: DiscordWebhookSettings,
): Promise<DiscordWebhookSettings> {
  const next: DiscordWebhookSettings = {
    presenceWebhookUrl: settings.presenceWebhookUrl?.trim() || null,
    inventoryWebhookUrl: settings.inventoryWebhookUrl?.trim() || null,
    itemMovesWebhookUrl: settings.itemMovesWebhookUrl?.trim() || null,
    pitpalStatusWebhookUrl: settings.pitpalStatusWebhookUrl?.trim() || null,
    notifyCameOnline: Boolean(settings.notifyCameOnline),
    notifyWentOffline: Boolean(settings.notifyWentOffline),
    notifyEveryOnlineScan: Boolean(settings.notifyEveryOnlineScan),
    notifyItemGainedLost: Boolean(settings.notifyItemGainedLost),
    notifyInventoryUpdated: Boolean(settings.notifyInventoryUpdated),
    notifyPitpalStatusChanges: Boolean(settings.notifyPitpalStatusChanges),
    onlineDashboardEnabled: Boolean(settings.onlineDashboardEnabled),
    onlineDashboardMessageId: settings.onlineDashboardMessageId?.trim() || null,
    onlineDashboardRosterKey: settings.onlineDashboardRosterKey ?? null,
    playerRules: (settings.playerRules ?? [])
      .map((rule) => normalizePlayerRule(rule))
      .filter((rule): rule is DiscordPlayerRule => Boolean(rule)),
  };
  assertOptionalWebhook(next.presenceWebhookUrl, "Presence webhook");
  assertOptionalWebhook(next.inventoryWebhookUrl, "Inventory webhook");
  assertOptionalWebhook(next.itemMovesWebhookUrl, "Item moves webhook");
  assertOptionalWebhook(next.pitpalStatusWebhookUrl, "PitPal status webhook");
  if (!next.presenceWebhookUrl) {
    next.onlineDashboardMessageId = null;
    next.onlineDashboardRosterKey = null;
  }

  const existing = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, DISCORD_WEBHOOK_SETTINGS_KEY))
    .limit(1);
  if (existing[0]) {
    await db
      .update(adminSettings)
      .set({ value: next, updatedAt: now() })
      .where(eq(adminSettings.key, DISCORD_WEBHOOK_SETTINGS_KEY));
  } else {
    await db.insert(adminSettings).values({
      key: DISCORD_WEBHOOK_SETTINGS_KEY,
      value: next,
      updatedAt: now(),
    });
  }
  return next;
}

export function resolvePlayerFlags(
  settings: DiscordWebhookSettings,
  accountId?: string | null,
): DiscordPlayerNotifyFlags {
  const defaults: DiscordPlayerNotifyFlags = {
    notifyCameOnline: settings.notifyCameOnline,
    notifyWentOffline: settings.notifyWentOffline,
    notifyEveryOnlineScan: settings.notifyEveryOnlineScan,
    notifyItemGainedLost: settings.notifyItemGainedLost,
    notifyInventoryUpdated: settings.notifyInventoryUpdated,
    notifyPitpalStatusChanges: settings.notifyPitpalStatusChanges,
  };
  if (!accountId) return defaults;
  const rule = settings.playerRules.find((row) => row.accountId === accountId);
  if (!rule) return defaults;
  return {
    notifyCameOnline: rule.notifyCameOnline,
    notifyWentOffline: rule.notifyWentOffline,
    notifyEveryOnlineScan: rule.notifyEveryOnlineScan,
    notifyItemGainedLost: rule.notifyItemGainedLost,
    notifyInventoryUpdated: rule.notifyInventoryUpdated,
    notifyPitpalStatusChanges: rule.notifyPitpalStatusChanges,
  };
}

export function webhookUrlForEvent(
  settings: DiscordWebhookSettings,
  kind: string,
): string | null {
  const presence = settings.presenceWebhookUrl;
  if (
    kind === "pitpal_entered" ||
    kind === "pitpal_left" ||
    kind === "pitpal_location" ||
    kind === "pitpal_lobby" ||
    kind === "pitpal_mismatch"
  ) {
    return settings.pitpalStatusWebhookUrl || presence;
  }
  if (kind === "came_online" || kind === "went_offline" || kind === "online_indexed") {
    return presence;
  }
  if (kind === "item_moved") {
    return settings.itemMovesWebhookUrl || presence;
  }
  if (kind === "inventory_updated" || kind === "inventory_changed") {
    return settings.inventoryWebhookUrl || presence;
  }
  return presence;
}

function anyWebhookConfigured(settings: DiscordWebhookSettings): boolean {
  return Boolean(
    settings.presenceWebhookUrl ||
      settings.inventoryWebhookUrl ||
      settings.itemMovesWebhookUrl ||
      settings.pitpalStatusWebhookUrl,
  );
}

function shouldNotify(
  flags: DiscordPlayerNotifyFlags,
  kind: string,
): boolean {
  if (kind === "online_indexed") return flags.notifyEveryOnlineScan;
  if (kind === "came_online") {
    return flags.notifyCameOnline && !flags.notifyEveryOnlineScan;
  }
  if (kind === "went_offline") return flags.notifyWentOffline;
  if (kind === "item_moved") return flags.notifyItemGainedLost;
  if (kind === "inventory_updated") return flags.notifyInventoryUpdated;
  if (kind === "inventory_changed") {
    return flags.notifyItemGainedLost || flags.notifyInventoryUpdated;
  }
  if (
    kind === "pitpal_entered" ||
    kind === "pitpal_left" ||
    kind === "pitpal_location" ||
    kind === "pitpal_lobby" ||
    kind === "pitpal_mismatch"
  ) {
    return flags.notifyPitpalStatusChanges;
  }
  return false;
}

function detailFromChanges(changes: InventoryChangeItem[]): string {
  return changes
    .slice(0, 6)
    .map((change) => {
      const label = formatInventoryChangeLabel(change);
      if (change.direction === "gained") return `gained ${label}`;
      if (change.direction === "lost") return `lost ${label}`;
      return `updated ${label}`;
    })
    .join("; ");
}

/** Split inventory_changed into item_moved vs inventory_updated for channel routing. */
export function expandDiscordNotifyEvents(events: DiscordNotifyEvent[]): DiscordNotifyEvent[] {
  const out: DiscordNotifyEvent[] = [];
  for (const event of events) {
    if (event.kind !== "inventory_changed") {
      out.push(event);
      continue;
    }
    const changes = event.changes ?? [];
    const moves = changes.filter(
      (change) => change.direction === "gained" || change.direction === "lost",
    );
    const updates = changes.filter((change) => change.direction === "updated");
    if (moves.length === 0 && updates.length === 0) {
      out.push(event);
      continue;
    }
    if (moves.length > 0) {
      out.push({
        ...event,
        kind: "item_moved",
        changes: moves,
        detail: detailFromChanges(moves),
      });
    }
    if (updates.length > 0) {
      out.push({
        ...event,
        kind: "inventory_updated",
        changes: updates,
        detail: detailFromChanges(updates),
      });
    }
  }
  return out;
}

function embedColor(kind: string): number {
  switch (kind) {
    case "came_online":
    case "online_indexed":
    case "pitpal_entered":
      return 0x57f287;
    case "went_offline":
    case "pitpal_left":
      return 0x99aab5;
    case "pitpal_location":
      return 0x5865f2;
    case "pitpal_lobby":
      return 0xeb459e;
    case "pitpal_mismatch":
      return 0xfaa61a;
    case "item_moved":
      return 0xeb459e;
    case "inventory_updated":
    case "inventory_changed":
      return 0xfee75c;
    default:
      return 0x5865f2;
  }
}

export function buildDiscordWebhookPayload(event: DiscordNotifyEvent): {
  content: string;
  embeds: Array<Record<string, unknown>>;
} {
  const headline =
    event.kind === "online_indexed"
      ? event.detail
        ? `${event.mcUsername} still online · ${event.detail}`
        : `${event.mcUsername} still online`
      : event.kind === "pitpal_entered"
        ? event.detail
          ? `${event.mcUsername} entered Pit · ${event.detail}`
          : `${event.mcUsername} entered Pit`
        : event.kind === "pitpal_left"
          ? `${event.mcUsername} left Pit lobbies`
          : event.kind === "pitpal_location"
            ? event.detail
              ? `${event.mcUsername} ${event.detail}`
              : `${event.mcUsername} status changed`
            : event.kind === "pitpal_lobby"
              ? event.detail
                ? `${event.mcUsername} lobby · ${event.detail}`
                : `${event.mcUsername} changed lobby`
              : event.kind === "pitpal_mismatch"
                ? event.detail
                  ? `${event.mcUsername} presence mismatch · ${event.detail}`
                  : `${event.mcUsername} presence mismatch`
                : event.kind === "item_moved" || event.kind === "inventory_updated"
                  ? describeLiveSignal({
                      kind: "inventory_changed",
                      mcUsername: event.mcUsername,
                      detail: event.detail,
                      changes: event.changes,
                    })
                  : describeLiveSignal({
                      kind: event.kind,
                      mcUsername: event.mcUsername,
                      detail: event.detail,
                      changes: event.changes,
                    });

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "Player", value: event.mcUsername || "Unknown", inline: true },
    { name: "Event", value: event.kind, inline: true },
  ];
  if (event.detail) {
    fields.push({ name: "Detail", value: event.detail.slice(0, 1000) });
  }
  if (event.changes && event.changes.length > 0) {
    const lines = event.changes.slice(0, 8).map((change) => {
      return `• **${change.direction}** ${change.title}${
        change.nonce ? ` (\`${change.nonce}\`)` : ""
      }${change.summary ? ` — ${change.summary}` : ""}`;
    });
    if (event.changes.length > 8) {
      lines.push(`• +${event.changes.length - 8} more`);
    }
    fields.push({ name: "Items", value: lines.join("\n").slice(0, 1000) });
  }

  return {
    content: headline.slice(0, 2000),
    embeds: [
      {
        title: headline.slice(0, 256),
        color: embedColor(event.kind),
        fields,
        timestamp: event.at ?? new Date().toISOString(),
        footer: { text: "Pitantir watch" },
      },
    ],
  };
}

export function rosterKeyFor(entries: OnlineRosterEntry[]): string {
  return entries
    .map(
      (entry) =>
        `${entry.mcUsername}\t${entry.lobby ?? ""}\t${entry.location ?? ""}\t${entry.sessionGame ?? ""}`,
    )
    .sort((a, b) => a.localeCompare(b))
    .join("\n");
}

export function buildOnlineDashboardPayload(
  entries: OnlineRosterEntry[],
  updatedAt: string,
): { content: string; embeds: Array<Record<string, unknown>> } {
  const sorted = [...entries].sort((a, b) =>
    a.mcUsername.localeCompare(b.mcUsername, undefined, { sensitivity: "base" }),
  );
  const lines =
    sorted.length === 0
      ? ["_Nobody on the watchlist is online._"]
      : sorted.map((entry) => {
          const bits = [
            entry.lobby,
            entry.location,
            entry.armorType,
            entry.killStreak && entry.killStreak > 0 ? `${entry.killStreak} ks` : null,
            !entry.lobby && entry.sessionGame ? entry.sessionGame : null,
          ].filter(Boolean);
          const suffix = bits.length ? ` — ${bits.map((bit) => `\`${bit}\``).join(" · ")}` : "";
          return `• **${entry.mcUsername}**${suffix}`;
        });
  const body = lines.join("\n");
  return {
    content: `**Online now (${sorted.length})**\n${body}`.slice(0, 2000),
    embeds: [
      {
        title: `Watchlist online · ${sorted.length}`,
        description: body.slice(0, 4096),
        color: 0x57f287,
        timestamp: updatedAt,
        footer: { text: "Pitantir online dashboard · edited in place" },
      },
    ],
  };
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

export async function postDiscordWebhook(
  webhookUrl: string,
  event: DiscordNotifyEvent,
): Promise<{ ok: boolean; status: number; error?: string; messageId?: string }> {
  if (!isDiscordWebhookUrl(webhookUrl)) {
    return { ok: false, status: 0, error: "Invalid Discord webhook URL." };
  }
  const payload = buildDiscordWebhookPayload(event);
  try {
    const result = await discordFetch(`${webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        error: result.text.slice(0, 200) || `Discord returned ${result.status}`,
      };
    }
    const messageId =
      result.json &&
      typeof result.json === "object" &&
      typeof (result.json as { id?: unknown }).id === "string"
        ? (result.json as { id: string }).id
        : undefined;
    return messageId
      ? { ok: true, status: result.status, messageId }
      : { ok: true, status: result.status };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Discord webhook request failed.",
    };
  }
}

async function editDiscordWebhookMessage(
  webhookUrl: string,
  messageId: string,
  payload: { content: string; embeds: Array<Record<string, unknown>> },
): Promise<boolean> {
  const result = await discordFetch(`${webhookUrl}/messages/${messageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return result.ok;
}

async function postRawDiscordWebhook(
  webhookUrl: string,
  payload: { content: string; embeds: Array<Record<string, unknown>> },
): Promise<{ ok: boolean; status: number; messageId?: string; error?: string }> {
  const result = await discordFetch(`${webhookUrl}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.text.slice(0, 200) || `Discord returned ${result.status}`,
    };
  }
  const messageId =
    result.json &&
    typeof result.json === "object" &&
    typeof (result.json as { id?: unknown }).id === "string"
      ? (result.json as { id: string }).id
      : undefined;
  return messageId
    ? { ok: true, status: result.status, messageId }
    : { ok: true, status: result.status };
}

/**
 * Update the presence-channel online roster in place (PATCH).
 * Only creates a new message when none exists or edit fails — never deletes.
 */
export async function refreshDiscordOnlineDashboard(
  db: Database,
  options?: { force?: boolean },
): Promise<void> {
  const settings = await getDiscordWebhookSettings(db);
  const webhookUrl = settings.presenceWebhookUrl;
  if (!webhookUrl || !settings.onlineDashboardEnabled) return;

  const repo = new AccountsRepository(db);
  const online = (await repo.listWatchlist())
    .filter((row) => row.lastHypixelOnline === true)
    .map((row) => ({
      mcUsername: row.mcUsername,
      sessionGame: row.lastSessionGame,
      seenAt: row.lastHypixelOnlineAt,
      lobby: row.lastPitpalLobby,
      location: row.lastPitpalLocation,
      armorType: row.lastPitpalArmorType,
      killStreak: row.lastPitpalKillstreak,
    }));
  const nextKey = rosterKeyFor(online);
  if (
    !options?.force &&
    nextKey === settings.onlineDashboardRosterKey &&
    settings.onlineDashboardMessageId
  ) {
    return;
  }

  const payload = buildOnlineDashboardPayload(online, new Date().toISOString());

  if (settings.onlineDashboardMessageId) {
    const edited = await editDiscordWebhookMessage(
      webhookUrl,
      settings.onlineDashboardMessageId,
      payload,
    );
    if (edited) {
      await setDiscordWebhookSettings(db, {
        ...settings,
        onlineDashboardRosterKey: nextKey,
      });
      return;
    }
  }

  const posted = await postRawDiscordWebhook(webhookUrl, payload);
  if (!posted.ok || !posted.messageId) return;

  await setDiscordWebhookSettings(db, {
    ...settings,
    onlineDashboardMessageId: posted.messageId,
    onlineDashboardRosterKey: nextKey,
  });
}

export type DiscordScanNotifyContext = {
  accountId: string;
  presenceOnline: boolean | null;
  mcUsername: string;
  sessionGame?: string | null;
  at?: string | null;
};

/** Best-effort notify with channel routing + per-player rules. */
export async function notifyDiscordForLiveEvents(
  db: Database,
  events: DiscordNotifyEvent[],
  context?: DiscordScanNotifyContext,
): Promise<{ postedCount: number }> {
  try {
    const settings = await getDiscordWebhookSettings(db);
    if (!anyWebhookConfigured(settings)) return { postedCount: 0 };

    const accountId = context?.accountId ?? events[0]?.accountId ?? null;
    const flags = resolvePlayerFlags(settings, accountId);
    const expanded = expandDiscordNotifyEvents(events);

    const toSend: DiscordNotifyEvent[] = expanded.filter((event) =>
      shouldNotify(flags, event.kind),
    );

    if (
      context?.presenceOnline === true &&
      flags.notifyEveryOnlineScan &&
      !toSend.some((event) => event.kind === "online_indexed")
    ) {
      toSend.push({
        kind: "online_indexed",
        accountId: context.accountId,
        mcUsername: context.mcUsername,
        detail: context.sessionGame ?? "online",
        at: context.at ?? new Date().toISOString(),
      });
    }

    let postedCount = 0;
    let postedPresence = false;
    for (const event of toSend) {
      const url = webhookUrlForEvent(settings, event.kind);
      if (!url) continue;
      const result = await postDiscordWebhook(url, event);
      if (result.ok) {
        postedCount += 1;
        if (
          event.kind === "came_online" ||
          event.kind === "went_offline" ||
          event.kind === "online_indexed"
        ) {
          postedPresence = true;
        }
      }
    }

    await refreshDiscordOnlineDashboard(db, { force: postedPresence }).catch(() => undefined);
    return { postedCount };
  } catch {
    return { postedCount: 0 };
  }
}

/**
 * Append-only PitPal status messages (SPAWN/DOWN/OTHER / lobby hops).
 * Never deletes prior messages — uses the dedicated pitpal status channel.
 */
export async function notifyPitpalStatusEvents(
  db: Database,
  events: DiscordNotifyEvent[],
): Promise<number> {
  try {
    if (events.length === 0) return 0;
    const settings = await getDiscordWebhookSettings(db);
    if (!settings.notifyPitpalStatusChanges) return 0;
    const url = settings.pitpalStatusWebhookUrl || settings.presenceWebhookUrl;
    if (!url) return 0;
    let posted = 0;
    for (const event of events) {
      const rule = settings.playerRules.find((row) => row.accountId === event.accountId);
      // Per-player override only when explicitly false; missing/legacy false repaired below.
      if (rule && rule.notifyPitpalStatusChanges === false) continue;
      const result = await postDiscordWebhook(url, {
        ...event,
        // Ensure kind is preserved for embed coloring/copy.
        kind: event.kind,
      });
      if (result.ok) posted += 1;
    }
    return posted;
  } catch {
    return 0;
  }
}
