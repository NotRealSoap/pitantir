import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { adminSettings } from "../schema/accounts.js";
import { now } from "../identity/store.js";
import { describeLiveSignal, type InventoryChangeItem } from "@pitantir/shared/live-signal-copy";
import type { LiveEventKind } from "./live-events.js";

export const DISCORD_WEBHOOK_SETTINGS_KEY = "discord_webhook";

export type DiscordWebhookSettings = {
  webhookUrl: string | null;
  notifyCameOnline: boolean;
  notifyWentOffline: boolean;
  notifyInventoryChanged: boolean;
};

export type DiscordNotifyEvent = {
  kind: LiveEventKind | string;
  mcUsername: string;
  detail?: string | null;
  changes?: InventoryChangeItem[] | null;
  at?: string | null;
};

const DEFAULT_SETTINGS: DiscordWebhookSettings = {
  webhookUrl: null,
  notifyCameOnline: true,
  notifyWentOffline: false,
  notifyInventoryChanged: true,
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

export function normalizeDiscordWebhookSettings(
  value: unknown,
): DiscordWebhookSettings {
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
  };
  if (next.webhookUrl && !isDiscordWebhookUrl(next.webhookUrl)) {
    throw new Error("Webhook URL must be a Discord webhook URL.");
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
  if (kind === "came_online") return settings.notifyCameOnline;
  if (kind === "went_offline") return settings.notifyWentOffline;
  if (kind === "inventory_changed") return settings.notifyInventoryChanged;
  return false;
}

function embedColor(kind: string): number {
  switch (kind) {
    case "came_online":
      return 0x57f287; // green
    case "went_offline":
      return 0x99aab5; // grey
    case "inventory_changed":
      return 0xfee75c; // gold
    default:
      return 0x5865f2;
  }
}

export function buildDiscordWebhookPayload(event: DiscordNotifyEvent): {
  content: string;
  embeds: Array<Record<string, unknown>>;
} {
  const headline = describeLiveSignal({
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

export async function postDiscordWebhook(
  webhookUrl: string,
  event: DiscordNotifyEvent,
): Promise<{ ok: boolean; status: number; error?: string }> {
  if (!isDiscordWebhookUrl(webhookUrl)) {
    return { ok: false, status: 0, error: "Invalid Discord webhook URL." };
  }
  const payload = buildDiscordWebhookPayload(event);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        status: response.status,
        error: text.slice(0, 200) || `Discord returned ${response.status}`,
      };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Discord webhook request failed.",
    };
  }
}

/** Best-effort notify for noteworthy live events. Never throws. */
export async function notifyDiscordForLiveEvents(
  db: Database,
  events: DiscordNotifyEvent[],
): Promise<void> {
  try {
    const settings = await getDiscordWebhookSettings(db);
    if (!settings.webhookUrl) return;
    const noteworthy = events.filter((event) => shouldNotify(settings, event.kind));
    for (const event of noteworthy) {
      await postDiscordWebhook(settings.webhookUrl, event);
    }
  } catch {
    // Webhook failures must not break scans.
  }
}
