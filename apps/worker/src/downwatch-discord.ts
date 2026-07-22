import type { Database } from "@pitantir/db";
import {
  addDownwatch,
  getDiscordWebhookSettings,
  getDownwatchState,
  listDownwatch,
  parseDownwatchCommand,
  removeDownwatch,
  setDownwatchCursor,
} from "@pitantir/db";

type DiscordMessage = {
  id: string;
  content?: string;
  author?: { id?: string; username?: string; bot?: boolean };
};

function botToken(): string | null {
  const token = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
  return token || null;
}

function resolveChannelId(settingsChannelId: string | null): string | null {
  const fromSettings = settingsChannelId?.trim() || "";
  if (/^\d{17,20}$/.test(fromSettings)) return fromSettings;
  const fromEnv = (process.env.DISCORD_DOWNWATCH_CHANNEL_ID ?? "").trim();
  if (/^\d{17,20}$/.test(fromEnv)) return fromEnv;
  return null;
}

async function discordApi(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "PitantirDownwatch (local; +https://github.com/NotRealSoap/pitantir)",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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

async function reply(
  token: string,
  channelId: string,
  content: string,
): Promise<void> {
  await discordApi(token, "POST", `/channels/${channelId}/messages`, {
    content: content.slice(0, 2000),
    allowed_mentions: { parse: [] },
  });
}

/**
 * Poll a Discord channel for `!downwatch` / `!dw` commands via Bot REST API.
 * No public HTTPS URL required — the worker pulls messages outbound.
 */
export async function pollDownwatchDiscordCommands(db: Database): Promise<{
  processed: number;
  skipped: boolean;
  reason?: string;
}> {
  const token = botToken();
  if (!token) {
    return { processed: 0, skipped: true, reason: "no_bot_token" };
  }

  const settings = await getDiscordWebhookSettings(db);
  const channelId = resolveChannelId(settings.downwatchChannelId);
  if (!channelId) {
    return { processed: 0, skipped: true, reason: "no_channel" };
  }

  const state = await getDownwatchState(db);
  const query = state.lastProcessedMessageId
    ? `?after=${encodeURIComponent(state.lastProcessedMessageId)}&limit=50`
    : "?limit=5";

  const listed = await discordApi(token, "GET", `/channels/${channelId}/messages${query}`);
  if (!listed.ok || !Array.isArray(listed.json)) {
    return {
      processed: 0,
      skipped: true,
      reason: `discord_http_${listed.status}`,
    };
  }

  const messages = (listed.json as DiscordMessage[])
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  // First run with no cursor: seed cursor to newest message so we don't replay history.
  if (!state.lastProcessedMessageId) {
    const newest = messages[messages.length - 1];
    if (newest?.id) {
      await setDownwatchCursor(db, newest.id);
    }
    return { processed: 0, skipped: false, reason: "seeded_cursor" };
  }

  let processed = 0;
  let lastId = state.lastProcessedMessageId;

  for (const message of messages) {
    lastId = message.id;
    if (message.author?.bot) continue;
    const content = typeof message.content === "string" ? message.content : "";
    const command = parseDownwatchCommand(content);
    if (!command) continue;

    const who = message.author?.username ?? message.author?.id ?? "discord";
    try {
      if (command.action === "help") {
        await reply(
          token,
          channelId,
          [
            "**Downwatch commands**",
            "`!downwatch add <IGN>` — ping role when they go PitPal DOWN",
            "`!downwatch remove <IGN>`",
            "`!downwatch list`",
            "Aliases: `!dw …`",
          ].join("\n"),
        );
      } else if (command.action === "list") {
        const entries = await listDownwatch(db);
        await reply(
          token,
          channelId,
          entries.length === 0
            ? "Downwatch list is empty."
            : `Downwatch (${entries.length}): ${entries.map((row) => row.mcUsername).join(", ")}`,
        );
      } else if (command.action === "add") {
        const result = await addDownwatch(db, command.mcUsername, { addedBy: who });
        await reply(
          token,
          channelId,
          result.created
            ? `Added **${result.entry.mcUsername}** to downwatch${
                result.promoted ? " (promoted to watchlist)" : ""
              }.`
            : `**${result.entry.mcUsername}** is already on downwatch.`,
        );
      } else if (command.action === "remove") {
        const result = await removeDownwatch(db, command.mcUsername);
        await reply(
          token,
          channelId,
          result.removed
            ? `Removed **${result.mcUsername}** from downwatch.`
            : `**${result.mcUsername}** was not on downwatch.`,
        );
      }
      processed += 1;
    } catch (error) {
      const err = error instanceof Error ? error.message : "Command failed.";
      await reply(token, channelId, `Downwatch error: ${err}`).catch(() => undefined);
      processed += 1;
    }
  }

  if (lastId !== state.lastProcessedMessageId) {
    await setDownwatchCursor(db, lastId);
  }

  return { processed, skipped: false };
}
