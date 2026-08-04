import { NextResponse } from "next/server";
import {
  isPitpalPresenceAuthoritative,
  notesIndicate140er,
  notesIndicateHighActivity,
  resolveEffectivePresence,
} from "@pitantir/db";
import { getAccountsRepository, getDatabase, isUsingPostgres } from "../../../src/server/runtime";
import { isHypixelConfigured } from "../../../src/server/hypixel-key-store";

const RECENTLY_ONLINE_MS = 10 * 60 * 1000;

function formatAge(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "never";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Pitantir 2.0 API board roster — watchlist accounts with online/offline queues.
 * Does not call Hypixel; reads last scan/presence state.
 */
export async function GET() {
  if (!isUsingPostgres()) {
    return NextResponse.json({ error: "API board requires DATABASE_URL." }, { status: 503 });
  }
  const repo = await getAccountsRepository();
  const db = getDatabase();
  if (!repo || !db) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const [watchlist, pitpalAuthoritative] = await Promise.all([
    repo.listWatchlist(),
    isPitpalPresenceAuthoritative(db),
  ]);

  const now = Date.now();
  const rows = watchlist
    .filter((row) => row.enabled && !notesIndicate140er(row.notes))
    .map((row) => {
      const presence = resolveEffectivePresence(row, { pitpalAuthoritative });
      const lastPingAt = row.lastSuccessScanAt?.getTime() ?? null;
      const lastOnlineAt =
        row.lastHypixelOnlineAt?.getTime() ??
        row.lastPitpalSeenAt?.getTime() ??
        null;
      const recentlyOnline =
        !presence.online &&
        lastOnlineAt !== null &&
        now - lastOnlineAt <= RECENTLY_ONLINE_MS;
      const highActivity =
        notesIndicateHighActivity(row.notes) || row.scanIntervalSeconds <= 300;
      const intendedIntervalSeconds = presence.online
        ? 15
        : highActivity
          ? 5 * 60
          : 30 * 60;

      return {
        id: row.id,
        mcUsername: row.mcUsername,
        online: presence.online,
        apiOff: presence.apiOff,
        recentlyOnline,
        highActivity,
        outline: presence.online ? "green" : recentlyOnline ? "yellow" : "none",
        lastPingAt: row.lastSuccessScanAt?.toISOString() ?? null,
        lastPingAge: formatAge(lastPingAt === null ? null : now - lastPingAt),
        lastPingAgeMs: lastPingAt === null ? null : now - lastPingAt,
        nextScanAt: row.nextScanAt.toISOString(),
        nextScanInMs: row.nextScanAt.getTime() - now,
        intendedIntervalSeconds,
        lobby: row.lastPitpalLobby,
        location: row.lastPitpalLocation,
        sessionGame: row.lastSessionGame,
        source: presence.apiOff ? "pitpal_api_off" : row.lastPresenceSource,
      };
    });

  const online = rows
    .filter((row) => row.online)
    .sort((a, b) => a.mcUsername.localeCompare(b.mcUsername, undefined, { sensitivity: "base" }));

  const offline = rows
    .filter((row) => !row.online)
    .sort((a, b) => a.nextScanInMs - b.nextScanInMs);

  return NextResponse.json({
    configured: isHypixelConfigured(),
    polledAt: new Date(now).toISOString(),
    intendedCadence: {
      onlineSeconds: 15,
      highActivitySeconds: 5 * 60,
      offlineSeconds: 30 * 60,
      recentlyOnlineMinutes: 10,
    },
    online,
    offline,
    onlineCount: online.length,
    offlineCount: offline.length,
  });
}
