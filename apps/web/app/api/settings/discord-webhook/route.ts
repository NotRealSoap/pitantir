import { NextResponse } from "next/server";
import {
  getDiscordWebhookSettings,
  isDiscordWebhookUrl,
  maskDiscordWebhookUrl,
  postDiscordWebhook,
  setDiscordWebhookSettings,
  type DiscordWebhookSettings,
} from "@pitantir/db";
import { getDatabase, isUsingPostgres } from "../../../../src/server/runtime";
import { InMemoryRateLimiter } from "../../../../src/server/rate-limit";

const rateLimiter = new InMemoryRateLimiter(20, 60_000);

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "anonymous"
  );
}

function publicView(settings: DiscordWebhookSettings) {
  return {
    configured: Boolean(settings.webhookUrl),
    webhookUrlMasked: maskDiscordWebhookUrl(settings.webhookUrl),
    notifyCameOnline: settings.notifyCameOnline,
    notifyWentOffline: settings.notifyWentOffline,
    notifyInventoryChanged: settings.notifyInventoryChanged,
  };
}

export async function GET() {
  if (!isUsingPostgres()) {
    return NextResponse.json(
      { error: "Discord webhook settings require DATABASE_URL." },
      { status: 503 },
    );
  }
  const db = getDatabase();
  if (!db) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }
  const settings = await getDiscordWebhookSettings(db);
  return NextResponse.json(publicView(settings));
}

export async function POST(request: Request) {
  const limit = rateLimiter.check(clientIp(request));
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Try again shortly." },
      { status: 429 },
    );
  }

  if (!isUsingPostgres()) {
    return NextResponse.json(
      { ok: false, error: "Discord webhook settings require DATABASE_URL." },
      { status: 503 },
    );
  }
  const db = getDatabase();
  if (!db) {
    return NextResponse.json({ ok: false, error: "Database unavailable." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "Invalid body." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const action = typeof input.action === "string" ? input.action : "save";
  const current = await getDiscordWebhookSettings(db);

  if (action === "test") {
    if (!current.webhookUrl) {
      return NextResponse.json(
        { ok: false, error: "Save a Discord webhook URL first." },
        { status: 400 },
      );
    }
    const result = await postDiscordWebhook(current.webhookUrl, {
      kind: "came_online",
      mcUsername: "Pitantir",
      detail: "webhook test",
      at: new Date().toISOString(),
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "Discord rejected the test." },
        { status: 400 },
      );
    }
    return NextResponse.json({
      ok: true,
      message: "Test notification sent.",
      ...publicView(current),
    });
  }

  if (action === "clear") {
    const next = await setDiscordWebhookSettings(db, {
      ...current,
      webhookUrl: null,
    });
    return NextResponse.json({
      ok: true,
      message: "Discord webhook cleared.",
      ...publicView(next),
    });
  }

  // save
  const webhookUrlRaw =
    typeof input.webhookUrl === "string" ? input.webhookUrl.trim() : "";
  let webhookUrl = current.webhookUrl;
  if (webhookUrlRaw) {
    if (!isDiscordWebhookUrl(webhookUrlRaw)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "URL must look like https://discord.com/api/webhooks/<id>/<token>",
        },
        { status: 400 },
      );
    }
    webhookUrl = webhookUrlRaw;
  }

  try {
    const next = await setDiscordWebhookSettings(db, {
      webhookUrl,
      notifyCameOnline:
        typeof input.notifyCameOnline === "boolean"
          ? input.notifyCameOnline
          : current.notifyCameOnline,
      notifyWentOffline:
        typeof input.notifyWentOffline === "boolean"
          ? input.notifyWentOffline
          : current.notifyWentOffline,
      notifyInventoryChanged:
        typeof input.notifyInventoryChanged === "boolean"
          ? input.notifyInventoryChanged
          : current.notifyInventoryChanged,
    });
    return NextResponse.json({
      ok: true,
      message: webhookUrlRaw
        ? "Discord webhook saved. Worker will notify on the next matching scan event."
        : "Notification preferences saved.",
      ...publicView(next),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save webhook.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
