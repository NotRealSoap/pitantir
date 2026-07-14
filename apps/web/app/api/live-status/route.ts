import { NextResponse } from "next/server";
import {
  getHypixelApiCalls,
  getHypixelLiveEvents,
  getHypixelRateLimitSnapshot,
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

  const [snapshot, watchlist, events, recentCalls] = await Promise.all([
    getHypixelRateLimitSnapshot(db),
    repo.listWatchlist(),
    getHypixelLiveEvents(db),
    getHypixelApiCalls(db),
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

  const online = watchlist
    .filter((row) => row.lastHypixelOnline === true)
    .map((row) => ({
      id: row.id,
      mcUsername: row.mcUsername,
      sessionGame: row.lastSessionGame,
      seenAt: row.lastHypixelOnlineAt,
      source: row.lastPresenceSource,
    }));

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
      itemHint: null as string | null,
    }));

  const noteworthy = events.filter((event) => event.kind !== "scanned").slice(0, 20);
  const latestCall = recentCalls[0] ?? null;

  return NextResponse.json({
    ...usage,
    online,
    onlineCount: online.length,
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
