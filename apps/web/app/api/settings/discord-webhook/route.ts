import { NextResponse } from "next/server";
import {
  getDiscordWebhookSettings,
  isDiscordWebhookUrl,
  maskDiscordWebhookUrl,
  postDiscordWebhook,
  refreshDiscordOnlineDashboard,
  setDiscordWebhookSettings,
  type DiscordPlayerRule,
  type DiscordWebhookSettings,
} from "@pitantir/db";
import {
  getAccountsRepository,
  getDatabase,
  isUsingPostgres,
} from "../../../../src/server/runtime";
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
    configured: Boolean(
      settings.presenceWebhookUrl ||
        settings.presenceAlertsWebhookUrl ||
        settings.inventoryWebhookUrl ||
        settings.itemMovesWebhookUrl ||
        settings.pitpalStatusWebhookUrl,
    ),
    presenceWebhookUrlMasked: maskDiscordWebhookUrl(settings.presenceWebhookUrl),
    presenceAlertsWebhookUrlMasked: maskDiscordWebhookUrl(settings.presenceAlertsWebhookUrl),
    inventoryWebhookUrlMasked: maskDiscordWebhookUrl(settings.inventoryWebhookUrl),
    itemMovesWebhookUrlMasked: maskDiscordWebhookUrl(settings.itemMovesWebhookUrl),
    pitpalStatusWebhookUrlMasked: maskDiscordWebhookUrl(settings.pitpalStatusWebhookUrl),
    notifyCameOnline: settings.notifyCameOnline,
    notifyWentOffline: settings.notifyWentOffline,
    notifyEveryOnlineScan: settings.notifyEveryOnlineScan,
    notifyItemGainedLost: settings.notifyItemGainedLost,
    notifyInventoryUpdated: settings.notifyInventoryUpdated,
    notifyPitpalStatusChanges: settings.notifyPitpalStatusChanges,
    onlineDashboardEnabled: settings.onlineDashboardEnabled,
    onlineDashboardConfigured: Boolean(settings.onlineDashboardMessageId),
    playerRules: settings.playerRules,
  };
}

function sanitizeDiscordWebhookInput(value: string): string {
  return value
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "");
}

function parseOptionalUrl(
  value: unknown,
  label: string,
):
  | { ok: true; provided: false }
  | { ok: true; provided: true; url: string | null }
  | { ok: false; error: string } {
  if (value === undefined) return { ok: true, provided: false };
  if (value === null || value === "") return { ok: true, provided: true, url: null };
  if (typeof value !== "string") return { ok: false, error: `${label} must be a string.` };
  const trimmed = sanitizeDiscordWebhookInput(value);
  if (!trimmed) return { ok: true, provided: true, url: null };
  if (!isDiscordWebhookUrl(trimmed)) {
    return {
      ok: false,
      error: `${label} must look like https://discord.com/api/webhooks/<id>/<token>`,
    };
  }
  return { ok: true, provided: true, url: trimmed };
}

function parsePlayerRules(value: unknown): DiscordPlayerRule[] {
  if (!Array.isArray(value)) return [];
  const out: DiscordPlayerRule[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const rule = row as Record<string, unknown>;
    if (typeof rule.accountId !== "string" || typeof rule.mcUsername !== "string") continue;
    out.push({
      accountId: rule.accountId,
      mcUsername: rule.mcUsername,
      notifyCameOnline:
        typeof rule.notifyCameOnline === "boolean" ? rule.notifyCameOnline : true,
      notifyWentOffline:
        typeof rule.notifyWentOffline === "boolean" ? rule.notifyWentOffline : false,
      notifyEveryOnlineScan:
        typeof rule.notifyEveryOnlineScan === "boolean" ? rule.notifyEveryOnlineScan : true,
      notifyItemGainedLost:
        typeof rule.notifyItemGainedLost === "boolean" ? rule.notifyItemGainedLost : true,
      notifyInventoryUpdated:
        typeof rule.notifyInventoryUpdated === "boolean" ? rule.notifyInventoryUpdated : false,
      notifyPitpalStatusChanges:
        typeof rule.notifyPitpalStatusChanges === "boolean"
          ? rule.notifyPitpalStatusChanges
          : true,
    });
  }
  return out;
}

export async function GET() {
  if (!isUsingPostgres()) {
    return NextResponse.json(
      { error: "Discord webhook settings require DATABASE_URL." },
      { status: 503 },
    );
  }
  const db = getDatabase();
  const repo = await getAccountsRepository();
  if (!db || !repo) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }
  const [settings, watchlist] = await Promise.all([
    getDiscordWebhookSettings(db),
    repo.listWatchlist(),
  ]);
  return NextResponse.json({
    ...publicView(settings),
    watchlist: watchlist.map((row) => ({ id: row.id, mcUsername: row.mcUsername })),
  });
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
  const repo = await getAccountsRepository();
  if (!db || !repo) {
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

  async function withWatchlist(settings: DiscordWebhookSettings) {
    const watchlist = await repo!.listWatchlist();
    return {
      ...publicView(settings),
      watchlist: watchlist.map((row) => ({ id: row.id, mcUsername: row.mcUsername })),
    };
  }

  if (action === "test") {
    const channel =
      typeof input.channel === "string" ? input.channel : "presence";
    // Prefer a URL typed in the settings form (also persists it) so paste+test works.
    const draft = parseOptionalUrl(input.webhookUrl, "Webhook");
    if (!draft.ok) {
      return NextResponse.json({ ok: false, error: draft.error }, { status: 400 });
    }
    let settings = current;
    if (draft.provided && draft.url) {
      const patch: DiscordWebhookSettings = { ...current };
      if (channel === "inventory") patch.inventoryWebhookUrl = draft.url;
      else if (channel === "itemMoves") patch.itemMovesWebhookUrl = draft.url;
      else if (channel === "pitpalStatus") patch.pitpalStatusWebhookUrl = draft.url;
      else if (channel === "presenceAlerts") patch.presenceAlertsWebhookUrl = draft.url;
      else patch.presenceWebhookUrl = draft.url;
      settings = await setDiscordWebhookSettings(db, patch);
    }
    const url =
      channel === "inventory"
        ? settings.inventoryWebhookUrl ||
          settings.presenceAlertsWebhookUrl ||
          settings.presenceWebhookUrl
        : channel === "itemMoves"
          ? settings.itemMovesWebhookUrl ||
            settings.presenceAlertsWebhookUrl ||
            settings.presenceWebhookUrl
          : channel === "pitpalStatus"
            ? settings.pitpalStatusWebhookUrl
            : channel === "presenceAlerts"
              ? settings.presenceAlertsWebhookUrl || settings.presenceWebhookUrl
              : settings.presenceWebhookUrl;
    if (!url) {
      return NextResponse.json(
        {
          ok: false,
          error:
            channel === "pitpalStatus"
              ? "Paste the PitPal status webhook URL above, then click Test (or Save)."
              : channel === "presenceAlerts"
                ? "Paste the online/offline alerts webhook URL above, then click Test (or Save)."
                : "Save a webhook URL for that channel first.",
        },
        { status: 400 },
      );
    }
    const kind =
      channel === "inventory"
        ? "inventory_updated"
        : channel === "itemMoves"
          ? "item_moved"
          : channel === "pitpalStatus"
            ? "pitpal_location"
            : channel === "presence"
              ? "online_indexed"
              : "came_online";
    const result = await postDiscordWebhook(url, {
      kind,
      mcUsername: "Pitantir",
      detail: `webhook test (${channel})`,
      at: new Date().toISOString(),
      changes:
        kind === "item_moved"
          ? [
              {
                direction: "gained",
                nonce: "0",
                title: "Test Mystic",
                summary: "0/1",
                slotKey: "inv:0",
              },
            ]
          : null,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "Discord rejected the test." },
        { status: 400 },
      );
    }
    if (channel === "presence") {
      await refreshDiscordOnlineDashboard(db, { force: true }).catch(() => undefined);
    }
    return NextResponse.json({
      ok: true,
      message:
        draft.provided && draft.url
          ? `Saved ${channel} webhook and sent test.`
          : `Test sent to ${channel} channel.`,
      ...(await withWatchlist(await getDiscordWebhookSettings(db))),
    });
  }

  if (action === "refresh_dashboard") {
    if (!current.presenceWebhookUrl) {
      return NextResponse.json(
        { ok: false, error: "Save an online dashboard webhook URL first." },
        { status: 400 },
      );
    }
    if (!current.onlineDashboardEnabled) {
      return NextResponse.json(
        { ok: false, error: "Enable the online dashboard first." },
        { status: 400 },
      );
    }
    await refreshDiscordOnlineDashboard(db, { force: true });
    return NextResponse.json({
      ok: true,
      message: "Online dashboard message posted/updated.",
      ...(await withWatchlist(await getDiscordWebhookSettings(db))),
    });
  }

  if (action === "clear") {
    for (const url of [
      current.presenceWebhookUrl,
      current.presenceAlertsWebhookUrl,
      current.inventoryWebhookUrl,
      current.itemMovesWebhookUrl,
      current.pitpalStatusWebhookUrl,
    ]) {
      if (url && current.onlineDashboardMessageId && url === current.presenceWebhookUrl) {
        try {
          await fetch(`${url}/messages/${current.onlineDashboardMessageId}`, {
            method: "DELETE",
            signal: AbortSignal.timeout(8_000),
          });
        } catch {
          // ignore
        }
      }
    }
    const next = await setDiscordWebhookSettings(db, {
      ...current,
      presenceWebhookUrl: null,
      presenceAlertsWebhookUrl: null,
      inventoryWebhookUrl: null,
      itemMovesWebhookUrl: null,
      pitpalStatusWebhookUrl: null,
      onlineDashboardMessageId: null,
      onlineDashboardRosterKey: null,
      playerRules: [],
    });
    return NextResponse.json({
      ok: true,
      message: "Discord webhooks cleared.",
      ...(await withWatchlist(next)),
    });
  }

  const presence = parseOptionalUrl(input.presenceWebhookUrl, "Online dashboard webhook");
  const presenceAlerts = parseOptionalUrl(
    input.presenceAlertsWebhookUrl,
    "Online/offline alerts webhook",
  );
  const inventory = parseOptionalUrl(input.inventoryWebhookUrl, "Inventory webhook");
  const itemMoves = parseOptionalUrl(input.itemMovesWebhookUrl, "Item moves webhook");
  const pitpalStatus = parseOptionalUrl(input.pitpalStatusWebhookUrl, "PitPal status webhook");
  if (!presence.ok) return NextResponse.json({ ok: false, error: presence.error }, { status: 400 });
  if (!presenceAlerts.ok) {
    return NextResponse.json({ ok: false, error: presenceAlerts.error }, { status: 400 });
  }
  if (!inventory.ok) return NextResponse.json({ ok: false, error: inventory.error }, { status: 400 });
  if (!itemMoves.ok) return NextResponse.json({ ok: false, error: itemMoves.error }, { status: 400 });
  if (!pitpalStatus.ok) return NextResponse.json({ ok: false, error: pitpalStatus.error }, { status: 400 });

  try {
    const next = await setDiscordWebhookSettings(db, {
      presenceWebhookUrl: presence.provided ? presence.url : current.presenceWebhookUrl,
      presenceAlertsWebhookUrl: presenceAlerts.provided
        ? presenceAlerts.url
        : current.presenceAlertsWebhookUrl,
      inventoryWebhookUrl: inventory.provided ? inventory.url : current.inventoryWebhookUrl,
      itemMovesWebhookUrl: itemMoves.provided ? itemMoves.url : current.itemMovesWebhookUrl,
      pitpalStatusWebhookUrl: pitpalStatus.provided
        ? pitpalStatus.url
        : current.pitpalStatusWebhookUrl,
      notifyCameOnline:
        typeof input.notifyCameOnline === "boolean"
          ? input.notifyCameOnline
          : current.notifyCameOnline,
      notifyWentOffline:
        typeof input.notifyWentOffline === "boolean"
          ? input.notifyWentOffline
          : current.notifyWentOffline,
      notifyEveryOnlineScan:
        typeof input.notifyEveryOnlineScan === "boolean"
          ? input.notifyEveryOnlineScan
          : current.notifyEveryOnlineScan,
      notifyItemGainedLost:
        typeof input.notifyItemGainedLost === "boolean"
          ? input.notifyItemGainedLost
          : current.notifyItemGainedLost,
      notifyInventoryUpdated:
        typeof input.notifyInventoryUpdated === "boolean"
          ? input.notifyInventoryUpdated
          : current.notifyInventoryUpdated,
      notifyPitpalStatusChanges:
        typeof input.notifyPitpalStatusChanges === "boolean"
          ? input.notifyPitpalStatusChanges
          : current.notifyPitpalStatusChanges,
      onlineDashboardEnabled:
        typeof input.onlineDashboardEnabled === "boolean"
          ? input.onlineDashboardEnabled
          : current.onlineDashboardEnabled,
      onlineDashboardMessageId: current.onlineDashboardMessageId,
      onlineDashboardRosterKey: current.onlineDashboardRosterKey,
      playerRules:
        input.playerRules !== undefined ? parsePlayerRules(input.playerRules) : current.playerRules,
    });

    if (next.presenceWebhookUrl && next.onlineDashboardEnabled) {
      await refreshDiscordOnlineDashboard(db, { force: true }).catch(() => undefined);
    }

    return NextResponse.json({
      ok: true,
      message: "Discord notification settings saved.",
      ...(await withWatchlist(await getDiscordWebhookSettings(db))),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save webhook.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
