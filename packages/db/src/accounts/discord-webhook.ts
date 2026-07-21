import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";
import { describeLiveSignal, type InventoryChangeItem } from "@pitantir/shared/live-signal-copy";
import type { LiveEventKind } from "./live-events.js";
import { AccountsRepository } from "./repository.js";

export const DISCORD_WEBHOOK_SETTINGS_KEY = "discord_webhook";

export type DiscordWebhookSettings = {
  webhookUrl: string | null;
  notifyCameOnline: boolean;
  notifyWentOffline: boolean;
  notifyInventoryChanged: boolean;
  /** Post every time a watched account is scanned while online. */
  notifyEveryOnlineScan: boolean;
  /** Keep an editable/reposted message listing who is online. */
  onlineDashboardEnabled: boolean;
  onlineDashboardMessageId: string | null;
  /** Sorted username key used to skip no-op dashboard refreshes. */
  onlineDashboardRosterKey: string | null;
};

export type DiscordNotifyEvent = {
  kind: LiveEventKind | string;
  mcUsername: string;
  detail?: string | null;
  changes?: InventoryChangeItem[] | null;
  at?: string | null;
};

export type OnlineRosterEntry = {
  mcUsername: string;
  sessionGame?: string | null;
  seenAt?: string | Date | null;
};

const DEFAULT_SETTINGS: DiscordWebhookSettings = {
  webhookUrl: null,
  notifyCameOnline: true,
  notifyWentOffline: false,
  notifyInventoryChanged: true,
  notifyEveryOnlineScan: true,
  onlineDashboardEnabled: true,
  onlineDashboardMessageId: null,
  onlineDashboardRosterKey: null,
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

export function normalizeDiscordWebhookSettings(value: unknown): DiscordWebhookSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS };
  }
  const row = value as Record<string, unknown>;
  const webhookUrl =
    typeof row.webhookUrl === "string" && row.webhookUrl.trim().length > 0
      ? row.webhookUrl.trim()
      : null;
  return {
    webhookUrl,
    notifyCameOnline:
      typeof row.notifyCameOnline === "boolean"
        ? row.notifyCameOnline
        : DEFAULT_SETTINGS.notifyCameOnline,
    notifyWentOffline:
      typeof row.notifyWentOffline === "boolean"
        ? row.notifyWentOffline
        : DEFAULT_SETTINGS.notifyWentOffline,
    notifyInventoryChanged:
      typeof row.notifyInventoryChanged === "boolean"
        ? row.notifyInventoryChanged
        : DEFAULT_SETTINGS.notifyInventoryChanged,
    notifyEveryOnlineScan:
      typeof row.notifyEveryOnlineScan === "boolean"
        ? row.notifyEveryOnlineScan
        : DEFAULT_SETTINGS.notifyEveryOnlineScan,
    onlineDashboardEnabled:
      typeof row.onlineDashboardEnabled === "boolean"
        ? row.onlineDashboardEnabled
        : DEFAULT_SETTINGS.onlineDashboardEnabled,
    onlineDashboardMessageId:
      typeof row.onlineDashboardMessageId === "string" && row.onlineDashboardMessageId.trim()
        ? row.onlineDashboardMessageId.trim()
        : null,
    onlineDashboardRosterKey:
      typeof row.onlineDashboardRosterKey === "string" ? row.onlineDashboardRosterKey : null,
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

export async function setDiscordWebhookSettings(
  db: Database,
  settings: DiscordWebhookSettings,
): Promise<DiscordWebhookSettings> {
  const next: DiscordWebhookSettings = {
    webhookUrl: settings.webhookUrl?.trim() || null,
    notifyCameOnline: Boolean(settings.notifyCameOnline),
    notifyWentOffline: Boolean(settings.notifyWentOffline),
    notifyInventoryChanged: Boolean(settings.notifyInventoryChanged),
    notifyEveryOnlineScan: Boolean(settings.notifyEveryOnlineScan),
    onlineDashboardEnabled: Boolean(settings.onlineDashboardEnabled),
    onlineDashboardMessageId: settings.onlineDashboardMessageId?.trim() || null,
    onlineDashboardRosterKey: settings.onlineDashboardRosterKey ?? null,
  };
  if (next.webhookUrl && !isDiscordWebhookUrl(next.webhookUrl)) {
    throw new Error("Webhook URL must be a Discord webhook URL.");
  }
  if (!next.webhookUrl) {
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

function shouldNotify(settings: DiscordWebhookSettings, kind: string): boolean {
  if (!settings.webhookUrl) return false;
  if (kind === "online_indexed") return settings.notifyEveryOnlineScan;
  if (kind === "came_online") {
    // Avoid double-posting when every online scan already covers the transition.
    return settings.notifyCameOnline && !settings.notifyEveryOnlineScan;
  }
  if (kind === "went_offline") return settings.notifyWentOffline;
  if (kind === "inventory_changed") return settings.notifyInventoryChanged;
  return false;
}

function embedColor(kind: string): number {
  switch (kind) {
    case "came_online":
    case "online_indexed":
      return 0x57f287;
    case "went_offline":
      return 0x99aab5;
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
  const kindForCopy = event.kind === "online_indexed" ? "scanned" : event.kind;
  const headline =
    event.kind === "online_indexed"
      ? event.detail
        ? `${event.mcUsername} still online · ${event.detail}`
        : `${event.mcUsername} still online`
      : describeLiveSignal({
          kind: kindForCopy,
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
    .map((entry) => `${entry.mcUsername}\t${entry.sessionGame ?? ""}`)
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
          const game = entry.sessionGame ? ` — \`${entry.sessionGame}\`` : "";
          return `• **${entry.mcUsername}**${game}`;
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
        footer: { text: "Pitantir online dashboard · kept as latest message" },
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
    return { ok: true, status: result.status, messageId };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Discord webhook request failed.",
    };
  }
}

async function deleteDiscordWebhookMessage(
  webhookUrl: string,
  messageId: string,
): Promise<void> {
  await discordFetch(`${webhookUrl}/messages/${messageId}`, { method: "DELETE" }).catch(
    () => undefined,
  );
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
  return { ok: true, status: result.status, messageId };
}

/**
 * Delete the previous roster message (if any) and post a fresh one so it stays
 * the latest message in a dedicated Discord channel.
 */
export async function refreshDiscordOnlineDashboard(
  db: Database,
  options?: { force?: boolean },
): Promise<void> {
  const settings = await getDiscordWebhookSettings(db);
  if (!settings.webhookUrl || !settings.onlineDashboardEnabled) return;

  const repo = new AccountsRepository(db);
  const online = (await repo.listWatchlist())
    .filter((row) => row.lastHypixelOnline === true)
    .map((row) => ({
      mcUsername: row.mcUsername,
      sessionGame: row.lastSessionGame,
      seenAt: row.lastHypixelOnlineAt,
    }));
  const nextKey = rosterKeyFor(online);
  if (!options?.force && nextKey === settings.onlineDashboardRosterKey && settings.onlineDashboardMessageId) {
    return;
  }

  if (settings.onlineDashboardMessageId) {
    await deleteDiscordWebhookMessage(settings.webhookUrl, settings.onlineDashboardMessageId);
  }

  const payload = buildOnlineDashboardPayload(online, new Date().toISOString());
  const posted = await postRawDiscordWebhook(settings.webhookUrl, payload);
  if (!posted.ok || !posted.messageId) return;

  await setDiscordWebhookSettings(db, {
    ...settings,
    onlineDashboardMessageId: posted.messageId,
    onlineDashboardRosterKey: nextKey,
  });
}

export type DiscordScanNotifyContext = {
  presenceOnline: boolean | null;
  mcUsername: string;
  sessionGame?: string | null;
  at?: string | null;
};

/** Best-effort notify for noteworthy live events + optional per-scan online pings. */
export async function notifyDiscordForLiveEvents(
  db: Database,
  events: DiscordNotifyEvent[],
  context?: DiscordScanNotifyContext,
): Promise<{ postedCount: number }> {
  try {
    const settings = await getDiscordWebhookSettings(db);
    if (!settings.webhookUrl) return { postedCount: 0 };

    const toSend: DiscordNotifyEvent[] = events.filter((event) =>
      shouldNotify(settings, event.kind),
    );

    if (
      context?.presenceOnline === true &&
      settings.notifyEveryOnlineScan &&
      !toSend.some((event) => event.kind === "online_indexed")
    ) {
      toSend.push({
        kind: "online_indexed",
        mcUsername: context.mcUsername,
        detail: context.sessionGame ?? "online",
        at: context.at ?? new Date().toISOString(),
      });
    }

    let postedCount = 0;
    for (const event of toSend) {
      const result = await postDiscordWebhook(settings.webhookUrl, event);
      if (result.ok) postedCount += 1;
    }

    // Always re-anchor the dashboard after we posted event messages so it stays last.
    // Otherwise only refresh when the roster itself changed.
    await refreshDiscordOnlineDashboard(db, { force: postedCount > 0 }).catch(() => undefined);
    return { postedCount };
  } catch {
    return { postedCount: 0 };
  }
}
