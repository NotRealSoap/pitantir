import { NextResponse } from "next/server";
import {
  addDownwatch,
  getDiscordWebhookSettings,
  listDownwatch,
  refreshDiscordOnlineDashboard,
  removeDownwatch,
} from "@pitantir/db";
import { getDatabase, isUsingPostgres } from "../../../../src/server/runtime";
import { InMemoryRateLimiter } from "../../../../src/server/rate-limit";

const rateLimiter = new InMemoryRateLimiter(30, 60_000);

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "anonymous"
  );
}

export async function GET() {
  if (!isUsingPostgres()) {
    return NextResponse.json({ error: "DATABASE_URL required." }, { status: 503 });
  }
  const db = getDatabase();
  if (!db) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }
  const [entries, settings] = await Promise.all([
    listDownwatch(db),
    getDiscordWebhookSettings(db),
  ]);
  return NextResponse.json({
    entries,
    downwatchRoleId: settings.downwatchRoleId,
    downwatchChannelId: settings.downwatchChannelId,
    downwatchWebhookConfigured: Boolean(settings.downwatchWebhookUrl),
    downwatchDashboardConfigured: Boolean(settings.downwatchDashboardMessageId),
    botTokenConfigured: Boolean(process.env.DISCORD_BOT_TOKEN?.trim()),
  });
}

export async function POST(request: Request) {
  const limit = rateLimiter.check(clientIp(request));
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  if (!isUsingPostgres()) {
    return NextResponse.json({ error: "DATABASE_URL required." }, { status: 503 });
  }
  const db = getDatabase();
  if (!db) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const action = typeof input.action === "string" ? input.action : "";
  const mcUsername = typeof input.mcUsername === "string" ? input.mcUsername : "";

  try {
    if (action === "add") {
      const result = await addDownwatch(db, mcUsername, { addedBy: "settings" });
      await refreshDiscordOnlineDashboard(db, { force: true }).catch(() => undefined);
      return NextResponse.json({
        ok: true,
        message: result.created
          ? `Added ${result.entry.mcUsername} to downwatch.`
          : `${result.entry.mcUsername} already on downwatch.`,
        entry: result.entry,
        entries: await listDownwatch(db),
      });
    }
    if (action === "remove") {
      const result = await removeDownwatch(db, mcUsername);
      await refreshDiscordOnlineDashboard(db, { force: true }).catch(() => undefined);
      return NextResponse.json({
        ok: true,
        message: result.removed
          ? `Removed ${result.mcUsername} from downwatch.`
          : `${result.mcUsername} was not on downwatch.`,
        entries: await listDownwatch(db),
      });
    }
    return NextResponse.json(
      { error: 'Unknown action. Use "add" or "remove".' },
      { status: 400 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Downwatch update failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
