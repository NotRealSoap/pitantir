import { NextResponse } from "next/server";
import {
  getHypixelApiCalls,
  getHypixelLiveEvents,
  getHypixelRateLimitSnapshot,
  isPitpalPresenceAuthoritative,
  resolveEffectivePresence,
} from "@pitantir/db";
import {
  getAccountsRepository,
  getDatabase,
  isUsingPostgres,
} from "../../../src/server/runtime";
import { isHypixelConfigured } from "../../../src/server/hypixel-key-store";
import { buildHypixelUsageView } from "../../../src/server/hypixel-usage";

/**
 * Live operator feed: Hypixel quota, recent API calls, online accounts, change events.
 * Polled by the site-wide status strip (reads last scan/probe data — no Hypixel calls).
 */
export async function GET() {
  if (!isUsingPostgres()) {
    return NextResponse.json(
      { error: "Live status requires DATABASE_URL." },
      { status: 503 },
    );
  }

  const repo = await getAccountsRepository();
  const db = getDatabase();
  if (!repo || !db) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const [snapshot, watchlist, events, recentCalls, pitpalAuthoritative] = await Promise.all([
    getHypixelRateLimitSnapshot(db),
    repo.listWatchlist(),
    getHypixelLiveEvents(db),
    getHypixelApiCalls(db),
    isPitpalPresenceAuthoritative(db),
  ]);

  const usage = buildHypixelUsageView({
    configured: isHypixelConfigured(),
    snapshot,
    watchlist,
  });

  const now = Date.now();
  const dueNow = watchlist.filter(
    (row) => row.enabled && row.nextScanAt.getTime() <= now,
  ).length;
  const nextDue = watchlist
    .filter((row) => row.enabled)
    .map((row) => row.nextScanAt.getTime())
    .sort((a, b) => a - b)
    .slice(0, 1)[0];

  const presenceOpts = { pitpalAuthoritative };
  const online = watchlist
    .map((row) => {
      const presence = resolveEffectivePresence(row, presenceOpts);
      if (!presence.online) return null;
      return {
        id: row.id,
        mcUsername: row.mcUsername,
        sessionGame: row.lastSessionGame,
        seenAt: row.lastPitpalSeenAt ?? row.lastHypixelOnlineAt,
        source: presence.apiOff ? "pitpal_api_off" : row.lastPresenceSource,
        lobby: row.lastPitpalLobby,
        location: row.lastPitpalLocation,
        armorType: row.lastPitpalArmorType,
        killStreak: row.lastPitpalKillstreak,
        apiOff: presence.apiOff,
        isNicked: row.lastPitpalIsNicked === true,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const noteworthy = events.filter((event) => event.kind !== "scanned").slice(0, 20);
  const latestCall = recentCalls[0] ?? null;

  const hintByAccount = new Map<string, string>();
  for (const event of noteworthy) {
    if (event.kind !== "inventory_changed" || hintByAccount.has(event.accountId)) continue;
    if (event.detail) hintByAccount.set(event.accountId, event.detail);
  }

  const recentlyChanged = watchlist
    .filter((row) => row.lastInventoryChangedAt)
    .sort((a, b) => {
      const aTime = a.lastInventoryChangedAt?.getTime() ?? 0;
      const bTime = b.lastInventoryChangedAt?.getTime() ?? 0;
      return bTime - aTime;
    })
    .slice(0, 12)
    .map((row) => ({
      id: row.id,
      mcUsername: row.mcUsername,
      changedAt: row.lastInventoryChangedAt,
      itemHint: hintByAccount.get(row.id) ?? null,
    }));

  return NextResponse.json({
    ...usage,
    online,
    onlineCount: online.length,
    pitpalAuthoritative,
    recentlyChanged,
    events: noteworthy,
    allEvents: events.slice(0, 30),
    recentCalls: recentCalls.slice(0, 12),
    latestCall,
    dueNowCount: dueNow,
    nextDueAt: nextDue ? new Date(nextDue).toISOString() : null,
    statusChecksEnabled:
      (process.env.HYPIXEL_STATUS_CHECKS ?? "").toLowerCase() === "1" ||
      (process.env.HYPIXEL_STATUS_CHECKS ?? "").toLowerCase() === "true",
    polledAt: new Date().toISOString(),
  });
}
