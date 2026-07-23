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
import { notesIndicate140er } from "./notes-labels.js";
import { eventIndicatesWentDown, getDownwatchState, isOnDownwatch } from "./downwatch.js";
import { resolveEffectivePresence } from "./presence.js";

export const DISCORD_WEBHOOK_SETTINGS_KEY = "discord_webhook";
/**
 * PitPal status webhook is stored in its own row so older worker/web code that
 * rewrites the main `discord_webhook` JSON blob cannot wipe it.
 */
export const DISCORD_PITPAL_STATUS_WEBHOOK_KEY = "discord_pitpal_status_webhook_url";

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
  /**
   * Online roster dashboard only (edited in place). Keep this channel clean —
   * put came-online / went-offline / still-online pings on presenceAlertsWebhookUrl.
   */
  presenceWebhookUrl: string | null;
  /**
   * Hypixel confirmatory online/offline index messages
   * (came_online / went_offline / online_indexed). Falls back to presenceWebhookUrl.
   */
  presenceAlertsWebhookUrl: string | null;
  /** Same-nonce inventory updates (lives/enchants/slot). */
  inventoryWebhookUrl: string | null;
  /** Item additions/subtractions (gained/lost). */
  itemMovesWebhookUrl: string | null;
  /**
   * PitPal lobby status changes (SPAWN/DOWN/OTHER, lobby hops).
   * Messages are append-only — never deleted by the dashboard refresher.
   */
  pitpalStatusWebhookUrl: string | null;
  /**
   * Optional second roster dashboard: effectively-online accounts that are NOT 140er-labelled.
   * Edited in place like the main online dashboard.
   */
  non140erDashboardWebhookUrl: string | null;
  /**
   * Discord snowflake for ops outage pings (e.g. ambienangel).
   * Username alone cannot ping — paste User ID from Discord Developer Mode.
   */
  /**
   * Optional webhook for PitPal lobby-monitor up/down (Tampermonkey ingest heartbeat).
   * Falls back to presenceAlertsWebhookUrl, then presenceWebhookUrl.
   */
  monitorWebhookUrl: string | null;
  opsAlertDiscordUserId: string | null;
  /**
   * Role snowflake pinged when a downwatch-listed account goes PitPal DOWN.
   */
  downwatchRoleId: string | null;
  /**
   * Channel the worker polls for `!downwatch` / `!dw` commands (requires DISCORD_BOT_TOKEN).
   */
  downwatchChannelId: string | null;
  /**
   * Optional webhook for DOWN role pings. Falls back to PitPal status, then alerts.
   */
  downwatchWebhookUrl: string | null;
  /**
   * Optional roster dashboard of effectively-online downwatch accounts (edited in place).
   */
  downwatchDashboardWebhookUrl: string | null;
  onlineDashboardEnabled: boolean;
  onlineDashboardMessageId: string | null;
  onlineDashboardRosterKey: string | null;
  non140erDashboardMessageId: string | null;
  non140erDashboardRosterKey: string | null;
  downwatchDashboardMessageId: string | null;
  downwatchDashboardRosterKey: string | null;
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
  /** PitPal-listed but Hypixel reports offline/unknown. */
  apiOff?: boolean;
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
  presenceAlertsWebhookUrl: null,
  inventoryWebhookUrl: null,
  itemMovesWebhookUrl: null,
  pitpalStatusWebhookUrl: null,
  non140erDashboardWebhookUrl: null,
  monitorWebhookUrl: null,
  opsAlertDiscordUserId: null,
  downwatchRoleId: null,
  downwatchChannelId: null,
  downwatchWebhookUrl: null,
  downwatchDashboardWebhookUrl: null,
  ...DEFAULT_FLAGS,
  onlineDashboardEnabled: true,
  onlineDashboardMessageId: null,
  onlineDashboardRosterKey: null,
  non140erDashboardMessageId: null,
  non140erDashboardRosterKey: null,
  downwatchDashboardMessageId: null,
  downwatchDashboardRosterKey: null,
  playerRules: [],
};

/** Display name used in Hypixel outage alerts (ping still needs opsAlertDiscordUserId). */
export const OPS_ALERT_DISCORD_USERNAME = "ambienangel";

const DISCORD_USER_ID_RE = /^\d{17,20}$/;

export function isDiscordUserId(value: string): boolean {
  return DISCORD_USER_ID_RE.test(value.trim());
}

export function isDiscordSnowflakeId(value: string): boolean {
  return DISCORD_USER_ID_RE.test(value.trim());
}

const DISCORD_WEBHOOK_RE =
  /^https:\/\/((?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w.-]+$/i;

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
  const presenceAlertsWebhookUrl = readUrl(row.presenceAlertsWebhookUrl);
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
    presenceAlertsWebhookUrl,
    inventoryWebhookUrl,
    itemMovesWebhookUrl,
    pitpalStatusWebhookUrl,
    non140erDashboardWebhookUrl: readUrl(row.non140erDashboardWebhookUrl),
    monitorWebhookUrl: readUrl(row.monitorWebhookUrl),
    opsAlertDiscordUserId: (() => {
      const raw =
        typeof row.opsAlertDiscordUserId === "string" ? row.opsAlertDiscordUserId.trim() : "";
      return raw && isDiscordUserId(raw) ? raw : null;
    })(),
    downwatchRoleId: (() => {
      const raw = typeof row.downwatchRoleId === "string" ? row.downwatchRoleId.trim() : "";
      return raw && isDiscordSnowflakeId(raw) ? raw : null;
    })(),
    downwatchChannelId: (() => {
      const raw = typeof row.downwatchChannelId === "string" ? row.downwatchChannelId.trim() : "";
      return raw && isDiscordSnowflakeId(raw) ? raw : null;
    })(),
    downwatchWebhookUrl: readUrl(row.downwatchWebhookUrl),
    downwatchDashboardWebhookUrl: readUrl(row.downwatchDashboardWebhookUrl),
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
    non140erDashboardMessageId:
      typeof row.non140erDashboardMessageId === "string" && row.non140erDashboardMessageId.trim()
        ? row.non140erDashboardMessageId.trim()
        : null,
    non140erDashboardRosterKey:
      typeof row.non140erDashboardRosterKey === "string" ? row.non140erDashboardRosterKey : null,
    downwatchDashboardMessageId:
      typeof row.downwatchDashboardMessageId === "string" &&
      row.downwatchDashboardMessageId.trim()
        ? row.downwatchDashboardMessageId.trim()
        : null,
    downwatchDashboardRosterKey:
      typeof row.downwatchDashboardRosterKey === "string"
        ? row.downwatchDashboardRosterKey
        : null,
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
  const settings = normalizeDiscordWebhookSettings(rows[0]?.value);

  const pitpalRows = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, DISCORD_PITPAL_STATUS_WEBHOOK_KEY))
    .limit(1);
  const pitpalValue = pitpalRows[0]?.value;
  const pitpalFromSide =
    typeof pitpalValue === "string"
      ? readUrl(pitpalValue)
      : pitpalValue && typeof pitpalValue === "object" && !Array.isArray(pitpalValue)
        ? readUrl((pitpalValue as Record<string, unknown>).url)
        : null;

  // Side-table wins when set — survives main-blob rewrites from older processes.
  if (pitpalFromSide) {
    settings.pitpalStatusWebhookUrl = pitpalFromSide;
  }
  return settings;
}

function assertOptionalWebhook(url: string | null, label: string): void {
  if (url && !isDiscordWebhookUrl(url)) {
    throw new Error(`${label} must be a Discord webhook URL.`);
  }
}

async function upsertAdminSetting(db: Database, key: string, value: unknown): Promise<void> {
  const existing = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, key))
    .limit(1);
  if (existing[0]) {
    await db
      .update(adminSettings)
      .set({ value, updatedAt: now() })
      .where(eq(adminSettings.key, key));
    return;
  }
  await db.insert(adminSettings).values({
    key,
    value,
    updatedAt: now(),
  });
}

async function deleteAdminSetting(db: Database, key: string): Promise<void> {
  await db.delete(adminSettings).where(eq(adminSettings.key, key));
}

export async function setDiscordWebhookSettings(
  db: Database,
  settings: DiscordWebhookSettings,
): Promise<DiscordWebhookSettings> {
  const existingRows = await db
    .select()
    .from(adminSettings)
    .where(eq(adminSettings.key, DISCORD_WEBHOOK_SETTINGS_KEY))
    .limit(1);
  const existingRaw =
    existingRows[0]?.value &&
    typeof existingRows[0].value === "object" &&
    !Array.isArray(existingRows[0].value)
      ? (existingRows[0].value as Record<string, unknown>)
      : {};

  const next: DiscordWebhookSettings = {
    presenceWebhookUrl: settings.presenceWebhookUrl?.trim() || null,
    presenceAlertsWebhookUrl: settings.presenceAlertsWebhookUrl?.trim() || null,
    inventoryWebhookUrl: settings.inventoryWebhookUrl?.trim() || null,
    itemMovesWebhookUrl: settings.itemMovesWebhookUrl?.trim() || null,
    pitpalStatusWebhookUrl: settings.pitpalStatusWebhookUrl?.trim() || null,
    non140erDashboardWebhookUrl: settings.non140erDashboardWebhookUrl?.trim() || null,
    monitorWebhookUrl: settings.monitorWebhookUrl?.trim() || null,
    opsAlertDiscordUserId: (() => {
      const raw = settings.opsAlertDiscordUserId?.trim() || "";
      return raw && isDiscordUserId(raw) ? raw : null;
    })(),
    downwatchRoleId: (() => {
      const raw = settings.downwatchRoleId?.trim() || "";
      return raw && isDiscordSnowflakeId(raw) ? raw : null;
    })(),
    downwatchChannelId: (() => {
      const raw = settings.downwatchChannelId?.trim() || "";
      return raw && isDiscordSnowflakeId(raw) ? raw : null;
    })(),
    downwatchWebhookUrl: settings.downwatchWebhookUrl?.trim() || null,
    downwatchDashboardWebhookUrl: settings.downwatchDashboardWebhookUrl?.trim() || null,
    notifyCameOnline: Boolean(settings.notifyCameOnline),
    notifyWentOffline: Boolean(settings.notifyWentOffline),
    notifyEveryOnlineScan: Boolean(settings.notifyEveryOnlineScan),
    notifyItemGainedLost: Boolean(settings.notifyItemGainedLost),
    notifyInventoryUpdated: Boolean(settings.notifyInventoryUpdated),
    notifyPitpalStatusChanges: Boolean(settings.notifyPitpalStatusChanges),
    onlineDashboardEnabled: Boolean(settings.onlineDashboardEnabled),
    onlineDashboardMessageId: settings.onlineDashboardMessageId?.trim() || null,
    onlineDashboardRosterKey: settings.onlineDashboardRosterKey ?? null,
    non140erDashboardMessageId: settings.non140erDashboardMessageId?.trim() || null,
    non140erDashboardRosterKey: settings.non140erDashboardRosterKey ?? null,
    downwatchDashboardMessageId: settings.downwatchDashboardMessageId?.trim() || null,
    downwatchDashboardRosterKey: settings.downwatchDashboardRosterKey ?? null,
    playerRules: (settings.playerRules ?? [])
      .map((rule) => normalizePlayerRule(rule))
      .filter((rule): rule is DiscordPlayerRule => Boolean(rule)),
  };
  assertOptionalWebhook(next.presenceWebhookUrl, "Online dashboard webhook");
  assertOptionalWebhook(next.presenceAlertsWebhookUrl, "Online/offline alerts webhook");
  assertOptionalWebhook(next.inventoryWebhookUrl, "Inventory webhook");
  assertOptionalWebhook(next.itemMovesWebhookUrl, "Item moves webhook");
  assertOptionalWebhook(next.pitpalStatusWebhookUrl, "PitPal status webhook");
  assertOptionalWebhook(next.non140erDashboardWebhookUrl, "Non-140er dashboard webhook");
  assertOptionalWebhook(next.monitorWebhookUrl, "Lobby monitor webhook");
  assertOptionalWebhook(next.downwatchWebhookUrl, "Downwatch webhook");
  assertOptionalWebhook(next.downwatchDashboardWebhookUrl, "Downwatch dashboard webhook");
  if (!next.presenceWebhookUrl) {
    next.onlineDashboardMessageId = null;
    next.onlineDashboardRosterKey = null;
  }
  if (!next.non140erDashboardWebhookUrl) {
    next.non140erDashboardMessageId = null;
    next.non140erDashboardRosterKey = null;
  }
  if (!next.downwatchDashboardWebhookUrl) {
    next.downwatchDashboardMessageId = null;
    next.downwatchDashboardRosterKey = null;
  }

  // Merge onto existing JSON so unknown/future keys are not dropped.
  const mergedBlob: Record<string, unknown> = {
    ...existingRaw,
    ...next,
  };
  await upsertAdminSetting(db, DISCORD_WEBHOOK_SETTINGS_KEY, mergedBlob);

  // Durable side storage — not affected when old code rewrites the main blob.
  if (next.pitpalStatusWebhookUrl) {
    await upsertAdminSetting(db, DISCORD_PITPAL_STATUS_WEBHOOK_KEY, {
      url: next.pitpalStatusWebhookUrl,
    });
  } else {
    const clearingAllChannels =
      !next.presenceWebhookUrl &&
      !next.presenceAlertsWebhookUrl &&
      !next.inventoryWebhookUrl &&
      !next.itemMovesWebhookUrl &&
      !next.non140erDashboardWebhookUrl &&
      !next.downwatchWebhookUrl &&
      !next.downwatchDashboardWebhookUrl;
    if (clearingAllChannels) {
      await deleteAdminSetting(db, DISCORD_PITPAL_STATUS_WEBHOOK_KEY);
    } else {
      // Preserve side-table URL when a partial rewrite omits PitPal (legacy workers).
      const pitpalRows = await db
        .select()
        .from(adminSettings)
        .where(eq(adminSettings.key, DISCORD_PITPAL_STATUS_WEBHOOK_KEY))
        .limit(1);
      const pitpalValue = pitpalRows[0]?.value;
      const preserved =
        typeof pitpalValue === "string"
          ? readUrl(pitpalValue)
          : pitpalValue && typeof pitpalValue === "object" && !Array.isArray(pitpalValue)
            ? readUrl((pitpalValue as Record<string, unknown>).url)
            : null;
      if (preserved) {
        next.pitpalStatusWebhookUrl = preserved;
        mergedBlob.pitpalStatusWebhookUrl = preserved;
        await upsertAdminSetting(db, DISCORD_WEBHOOK_SETTINGS_KEY, mergedBlob);
      }
    }
  }

  return next;
}

/** Patch only dashboard message metadata without risking channel URL loss. */
export async function setDiscordOnlineDashboardMeta(
  db: Database,
  meta: {
    onlineDashboardMessageId?: string | null;
    onlineDashboardRosterKey?: string | null;
    non140erDashboardMessageId?: string | null;
    non140erDashboardRosterKey?: string | null;
    downwatchDashboardMessageId?: string | null;
    downwatchDashboardRosterKey?: string | null;
  },
): Promise<void> {
  const current = await getDiscordWebhookSettings(db);
  await setDiscordWebhookSettings(db, {
    ...current,
    onlineDashboardMessageId:
      meta.onlineDashboardMessageId !== undefined
        ? meta.onlineDashboardMessageId
        : current.onlineDashboardMessageId,
    onlineDashboardRosterKey:
      meta.onlineDashboardRosterKey !== undefined
        ? meta.onlineDashboardRosterKey
        : current.onlineDashboardRosterKey,
    non140erDashboardMessageId:
      meta.non140erDashboardMessageId !== undefined
        ? meta.non140erDashboardMessageId
        : current.non140erDashboardMessageId,
    non140erDashboardRosterKey:
      meta.non140erDashboardRosterKey !== undefined
        ? meta.non140erDashboardRosterKey
        : current.non140erDashboardRosterKey,
    downwatchDashboardMessageId:
      meta.downwatchDashboardMessageId !== undefined
        ? meta.downwatchDashboardMessageId
        : current.downwatchDashboardMessageId,
    downwatchDashboardRosterKey:
      meta.downwatchDashboardRosterKey !== undefined
        ? meta.downwatchDashboardRosterKey
        : current.downwatchDashboardRosterKey,
  });
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
  const dashboard = settings.presenceWebhookUrl;
  const alerts = settings.presenceAlertsWebhookUrl || dashboard;
  if (
    kind === "pitpal_entered" ||
    kind === "pitpal_left" ||
    kind === "pitpal_location" ||
    kind === "pitpal_lobby" ||
    kind === "pitpal_mismatch"
  ) {
    // PitPal lobbies traffic never shares the dashboard/alerts channels.
    return settings.pitpalStatusWebhookUrl;
  }
  if (kind === "came_online" || kind === "went_offline" || kind === "online_indexed") {
    return alerts;
  }
  if (kind === "item_moved") {
    return settings.itemMovesWebhookUrl || alerts || dashboard;
  }
  if (kind === "inventory_updated" || kind === "inventory_changed") {
    return settings.inventoryWebhookUrl || alerts || dashboard;
  }
  return alerts || dashboard;
}

function anyWebhookConfigured(settings: DiscordWebhookSettings): boolean {
  return Boolean(
    settings.presenceWebhookUrl ||
      settings.presenceAlertsWebhookUrl ||
      settings.inventoryWebhookUrl ||
      settings.itemMovesWebhookUrl ||
      settings.pitpalStatusWebhookUrl ||
      settings.non140erDashboardWebhookUrl ||
      settings.monitorWebhookUrl ||
      settings.downwatchWebhookUrl ||
      settings.downwatchDashboardWebhookUrl,
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
        `${entry.mcUsername}\t${entry.lobby ?? ""}\t${entry.location ?? ""}\t${entry.sessionGame ?? ""}\t${entry.apiOff ? "apiOff" : ""}`,
    )
    .sort((a, b) => a.localeCompare(b))
    .join("\n");
}

export type OnlineDashboardPayloadOptions = {
  /** Headline prefix before the count, e.g. "Online now" or "Non-140er online". */
  headline?: string;
  /** Embed title prefix before "· N". */
  title?: string;
  emptyMessage?: string;
  footer?: string;
};

export function buildOnlineDashboardPayload(
  entries: OnlineRosterEntry[],
  updatedAt: string,
  options?: OnlineDashboardPayloadOptions,
): { content: string; embeds: Array<Record<string, unknown>> } {
  const headline = options?.headline ?? "Online now";
  const title = options?.title ?? "Watchlist online";
  const emptyMessage = options?.emptyMessage ?? "_Nobody on the watchlist is online._";
  const footer = options?.footer ?? "Pitantir online dashboard · edited in place";
  const sorted = [...entries].sort((a, b) =>
    a.mcUsername.localeCompare(b.mcUsername, undefined, { sensitivity: "base" }),
  );
  const lines =
    sorted.length === 0
      ? [emptyMessage]
      : sorted.map((entry) => {
          const bits = [
            entry.lobby,
            entry.location,
            entry.armorType,
            entry.killStreak && entry.killStreak > 0 ? `${entry.killStreak} ks` : null,
            !entry.lobby && entry.sessionGame ? entry.sessionGame : null,
            entry.apiOff ? "API Off" : null,
          ].filter(Boolean);
          const suffix = bits.length ? ` — ${bits.map((bit) => `\`${bit}\``).join(" · ")}` : "";
          return `• **${entry.mcUsername}**${suffix}`;
        });
  const body = lines.join("\n");
  return {
    content: `**${headline} (${sorted.length})**\n${body}`.slice(0, 2000),
    embeds: [
      {
        title: `${title} · ${sorted.length}`,
        description: body.slice(0, 4096),
        color: 0x57f287,
        timestamp: updatedAt,
        footer: { text: footer },
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
  payload: {
    content: string;
    embeds?: Array<Record<string, unknown>>;
    allowed_mentions?: { parse?: string[]; users?: string[] };
  },
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

function resolveOpsAlertDiscordUserId(settings: DiscordWebhookSettings): string | null {
  const fromSettings = settings.opsAlertDiscordUserId?.trim() || "";
  if (fromSettings && isDiscordUserId(fromSettings)) return fromSettings;
  const fromEnv = (process.env.DISCORD_OPS_ALERT_USER_ID ?? "").trim();
  if (fromEnv && isDiscordUserId(fromEnv)) return fromEnv;
  return null;
}

/**
 * One-shot Hypixel outage ping (circuit breaker). Uses alerts channel, else dashboard.
 * Mentions opsAlertDiscordUserId when configured (Discord requires a snowflake to ping).
 */
export async function notifyHypixelApiOutage(
  db: Database,
  input: {
    consecutiveFailures: number;
    detail: string;
    at?: string;
  },
): Promise<boolean> {
  const settings = await getDiscordWebhookSettings(db);
  const webhookUrl =
    settings.presenceAlertsWebhookUrl || settings.presenceWebhookUrl || null;
  if (!webhookUrl) return false;

  const userId = resolveOpsAlertDiscordUserId(settings);
  const mention = userId ? `<@${userId}>` : `@${OPS_ALERT_DISCORD_USERNAME}`;
  const headline = `${mention} Hypixel API paused after ${input.consecutiveFailures} consecutive failures`;
  const detail = input.detail.slice(0, 900);
  const content = `${headline}\n${detail}\nResume Hypixel refreshing on the Accounts page after fixing the outage.`.slice(
    0,
    2000,
  );

  const posted = await postRawDiscordWebhook(webhookUrl, {
    content,
    embeds: [
      {
        title: "Hypixel API circuit open",
        description: detail,
        color: 0xed4245,
        timestamp: input.at ?? new Date().toISOString(),
        footer: { text: "Pitantir · auto-paused after consecutive failures" },
        fields: [
          {
            name: "Operator",
            value: userId
              ? `${OPS_ALERT_DISCORD_USERNAME} (<@${userId}>)`
              : `${OPS_ALERT_DISCORD_USERNAME} (set ops Discord user ID in Settings to enable a real ping)`,
            inline: true,
          },
          {
            name: "Failures",
            value: String(input.consecutiveFailures),
            inline: true,
          },
        ],
      },
    ],
    allowed_mentions: userId ? { parse: [], users: [userId] } : { parse: [] },
  });
  return posted.ok;
}

function formatMonitorAge(ageMs: number | null): string {
  if (ageMs == null) return "never";
  const totalSec = Math.max(0, Math.floor(ageMs / 1000));
  if (totalSec < 60) return `${totalSec}s ago`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s ago` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m ago` : `${hours}h ago`;
}

/**
 * Discord alert when Tampermonkey lobby ingest goes stale or resumes.
 * Uses monitorWebhookUrl, else online/offline alerts, else dashboard webhook.
 * Mentions ops Discord user when configured.
 */
export async function notifyPitpalMonitorStatus(
  db: Database,
  input: {
    kind: "went_offline" | "came_online";
    ageMs: number | null;
    staleMs: number;
    offlineSince?: string | null;
    lastIngestAt?: string | null;
    at?: string;
  },
): Promise<boolean> {
  const settings = await getDiscordWebhookSettings(db);
  const webhookUrl =
    settings.monitorWebhookUrl ||
    settings.presenceAlertsWebhookUrl ||
    settings.presenceWebhookUrl ||
    null;
  if (!webhookUrl) return false;

  const userId = resolveOpsAlertDiscordUserId(settings);
  const mention = userId ? `<@${userId}>` : null;
  const staleMinutes = Math.round(input.staleMs / 60_000);
  const ageLabel = formatMonitorAge(input.ageMs);
  const at = input.at ?? new Date().toISOString();

  if (input.kind === "went_offline") {
    const headline = mention
      ? `${mention} Pitantir lobby monitoring stopped`
      : "Pitantir lobby monitoring stopped";
    const detail =
      input.ageMs == null
        ? `No Tampermonkey lobby ingest has been received yet (threshold ${staleMinutes}m).`
        : `No lobby ingest for ${ageLabel} (threshold ${staleMinutes}m). Check that the Mac is awake, web is running, and the PitPal tab + Tampermonkey script are active.`;
    const posted = await postRawDiscordWebhook(webhookUrl, {
      content: `${headline}\n${detail}`.slice(0, 2000),
      embeds: [
        {
          title: "Lobby monitor offline",
          description: detail,
          color: 0xed4245,
          timestamp: at,
          footer: { text: "Pitantir · Tampermonkey lobby heartbeat" },
          fields: [
            { name: "Last ingest", value: ageLabel, inline: true },
            {
              name: "Stale after",
              value: `${staleMinutes} minutes`,
              inline: true,
            },
          ],
        },
      ],
      allowed_mentions: userId ? { parse: [], users: [userId] } : { parse: [] },
    });
    return posted.ok;
  }

  const headline = mention
    ? `${mention} Pitantir lobby monitoring resumed`
    : "Pitantir lobby monitoring resumed";
  const detail = `Lobby ingest is flowing again (last ingest ${ageLabel}).`;
  const posted = await postRawDiscordWebhook(webhookUrl, {
    content: `${headline}\n${detail}`.slice(0, 2000),
    embeds: [
      {
        title: "Lobby monitor online",
        description: detail,
        color: 0x57f287,
        timestamp: at,
        footer: { text: "Pitantir · Tampermonkey lobby heartbeat" },
        fields: [{ name: "Last ingest", value: ageLabel, inline: true }],
      },
    ],
    allowed_mentions: userId ? { parse: [], users: [userId] } : { parse: [] },
  });
  return posted.ok;
}

async function upsertDashboardMessage(options: {
  db: Database;
  webhookUrl: string;
  messageId: string | null;
  rosterKey: string | null;
  nextKey: string;
  payload: { content: string; embeds: Array<Record<string, unknown>> };
  force: boolean;
  messageIdField:
    | "onlineDashboardMessageId"
    | "non140erDashboardMessageId"
    | "downwatchDashboardMessageId";
  rosterKeyField:
    | "onlineDashboardRosterKey"
    | "non140erDashboardRosterKey"
    | "downwatchDashboardRosterKey";
}): Promise<void> {
  if (!options.force && options.nextKey === options.rosterKey && options.messageId) {
    return;
  }

  if (options.messageId) {
    const edited = await editDiscordWebhookMessage(
      options.webhookUrl,
      options.messageId,
      options.payload,
    );
    if (edited) {
      await setDiscordOnlineDashboardMeta(options.db, {
        [options.rosterKeyField]: options.nextKey,
      });
      return;
    }
  }

  const posted = await postRawDiscordWebhook(options.webhookUrl, options.payload);
  if (!posted.ok || !posted.messageId) return;

  await setDiscordOnlineDashboardMeta(options.db, {
    [options.messageIdField]: posted.messageId,
    [options.rosterKeyField]: options.nextKey,
  });
}

/**
 * Update roster dashboards in place (PATCH).
 * Main presence channel: all effectively-online watchlist accounts.
 * Optional non-140er channel: same roster minus 140er-labelled notes.
 * Optional downwatch channel: effectively-online accounts on the downwatch list.
 * Only creates a new message when none exists or edit fails — never deletes.
 */
export async function refreshDiscordOnlineDashboard(
  db: Database,
  options?: { force?: boolean },
): Promise<void> {
  const settings = await getDiscordWebhookSettings(db);
  if (!settings.onlineDashboardEnabled) return;

  const repo = new AccountsRepository(db);
  const downwatch = await getDownwatchState(db);
  const downwatchNames = new Set(
    downwatch.entries.map((entry) => entry.mcUsername.toLowerCase()),
  );
  // Dynamic import avoids a static cycle with pitpal-lobbies → discord-webhook.
  const { isPitpalPresenceAuthoritative } = await import("./pitpal-lobbies.js");
  const presenceOpts = {
    pitpalAuthoritative: await isPitpalPresenceAuthoritative(db),
  };

  const onlineWithNotes = (await repo.listWatchlist())
    .map((row) => {
      const presence = resolveEffectivePresence(row, presenceOpts);
      if (!presence.online) return null;
      return {
        mcUsername: row.mcUsername,
        sessionGame: row.lastSessionGame,
        seenAt: row.lastPitpalSeenAt ?? row.lastHypixelOnlineAt,
        lobby: row.lastPitpalLobby,
        location: row.lastPitpalLocation,
        armorType: row.lastPitpalArmorType,
        killStreak: row.lastPitpalKillstreak,
        apiOff: presence.apiOff,
        notes: row.notes,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const online: OnlineRosterEntry[] = onlineWithNotes.map(
    ({ notes: _notes, ...entry }) => entry,
  );
  const non140er: OnlineRosterEntry[] = onlineWithNotes
    .filter((row) => !notesIndicate140er(row.notes))
    .map(({ notes: _notes, ...entry }) => entry);
  const downwatchOnline: OnlineRosterEntry[] = onlineWithNotes
    .filter((row) => downwatchNames.has(row.mcUsername.toLowerCase()))
    .map(({ notes: _notes, ...entry }) => entry);

  const updatedAt = new Date().toISOString();

  if (settings.presenceWebhookUrl) {
    await upsertDashboardMessage({
      db,
      webhookUrl: settings.presenceWebhookUrl,
      messageId: settings.onlineDashboardMessageId,
      rosterKey: settings.onlineDashboardRosterKey,
      nextKey: rosterKeyFor(online),
      payload: buildOnlineDashboardPayload(online, updatedAt),
      force: Boolean(options?.force),
      messageIdField: "onlineDashboardMessageId",
      rosterKeyField: "onlineDashboardRosterKey",
    });
  }

  if (settings.non140erDashboardWebhookUrl) {
    await upsertDashboardMessage({
      db,
      webhookUrl: settings.non140erDashboardWebhookUrl,
      messageId: settings.non140erDashboardMessageId,
      rosterKey: settings.non140erDashboardRosterKey,
      nextKey: rosterKeyFor(non140er),
      payload: buildOnlineDashboardPayload(non140er, updatedAt, {
        headline: "Non-140er online",
        title: "Non-140er online",
        emptyMessage: "_No non-140er watchlist accounts are online._",
        footer: "Pitantir non-140er dashboard · edited in place",
      }),
      force: Boolean(options?.force),
      messageIdField: "non140erDashboardMessageId",
      rosterKeyField: "non140erDashboardRosterKey",
    });
  }

  if (settings.downwatchDashboardWebhookUrl) {
    await upsertDashboardMessage({
      db,
      webhookUrl: settings.downwatchDashboardWebhookUrl,
      messageId: settings.downwatchDashboardMessageId,
      rosterKey: settings.downwatchDashboardRosterKey,
      nextKey: rosterKeyFor(downwatchOnline),
      payload: buildOnlineDashboardPayload(downwatchOnline, updatedAt, {
        headline: "Downwatch online",
        title: "Downwatch online",
        emptyMessage: "_No downwatch accounts are online._",
        footer: "Pitantir downwatch dashboard · edited in place",
      }),
      force: Boolean(options?.force),
      messageIdField: "downwatchDashboardMessageId",
      rosterKeyField: "downwatchDashboardRosterKey",
    });
  }
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
 * Append-only PitPal status messages (SPAWN/DOWN/OTHER / lobby hops / enter / leave).
 * Requires the dedicated PitPal status webhook — never posts to online/offline presence.
 */
export async function notifyPitpalStatusEvents(
  db: Database,
  events: DiscordNotifyEvent[],
): Promise<number> {
  try {
    if (events.length === 0) return 0;
    const settings = await getDiscordWebhookSettings(db);
    if (!settings.notifyPitpalStatusChanges) return 0;
    const url = settings.pitpalStatusWebhookUrl;
    if (!url) return 0;
    let posted = 0;
    for (const event of events) {
      const rule = settings.playerRules.find((row) => row.accountId === event.accountId);
      if (rule && rule.notifyPitpalStatusChanges === false) continue;
      const result = await postDiscordWebhook(url, event);
      if (result.ok) posted += 1;
    }
    return posted;
  } catch {
    return 0;
  }
}

/**
 * Role-ping when a downwatch-listed account transitions to PitPal DOWN.
 * Independent of per-player PitPal mute flags (140er rules still get this ping).
 */
export async function notifyDownwatchWentDown(
  db: Database,
  events: DiscordNotifyEvent[],
): Promise<number> {
  try {
    const downEvents = events.filter(eventIndicatesWentDown);
    if (downEvents.length === 0) return 0;

    const [settings, state] = await Promise.all([
      getDiscordWebhookSettings(db),
      getDownwatchState(db),
    ]);
    if (state.entries.length === 0) return 0;

    const roleId =
      settings.downwatchRoleId?.trim() ||
      (process.env.DISCORD_DOWNWATCH_ROLE_ID ?? "").trim() ||
      null;
    if (!roleId || !isDiscordSnowflakeId(roleId)) return 0;

    const webhookUrl =
      settings.downwatchWebhookUrl ||
      settings.pitpalStatusWebhookUrl ||
      settings.presenceAlertsWebhookUrl ||
      settings.presenceWebhookUrl;
    if (!webhookUrl) return 0;

    let posted = 0;
    for (const event of downEvents) {
      if (!isOnDownwatch(state, event.mcUsername)) continue;
      const mention = `<@&${roleId}>`;
      const detail = event.detail?.trim() || "DOWN";
      const content =
        `${mention} **${event.mcUsername}** went DOWN · ${detail}`.slice(0, 2000);
      const result = await postRawDiscordWebhook(webhookUrl, {
        content,
        embeds: [
          {
            title: `${event.mcUsername} · DOWN`,
            description: detail.slice(0, 1000),
            color: 0xed4245,
            timestamp: event.at ?? new Date().toISOString(),
            footer: { text: "Pitantir downwatch" },
          },
        ],
        allowed_mentions: { parse: [], roles: [roleId] },
      });
      if (result.ok) posted += 1;
    }
    return posted;
  } catch {
    return 0;
  }
}
