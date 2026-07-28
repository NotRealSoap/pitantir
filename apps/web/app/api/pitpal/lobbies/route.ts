import { NextResponse } from "next/server";
import {
  getPitpalLobbySnapshot,
  getPitpalMonitorState,
  ingestPitpalLobbies,
  PITPAL_MONITOR_STALE_MS,
} from "@pitantir/db";
import { getDatabase, isUsingPostgres } from "../../../../src/server/runtime";
import { InMemoryRateLimiter } from "../../../../src/server/rate-limit";

const rateLimiter = new InMemoryRateLimiter(60, 60_000);

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "anonymous"
  );
}

/** Latest PitPal lobby snapshot (for Watch / diagnostics). */
export async function GET() {
  if (!isUsingPostgres()) {
    return NextResponse.json({ error: "DATABASE_URL required." }, { status: 503 });
  }
  const db = getDatabase();
  if (!db) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }
  const [snapshot, monitor] = await Promise.all([
    getPitpalLobbySnapshot(db),
    getPitpalMonitorState(db),
  ]);
  const nowMs = Date.now();
  let ageMs: number | null = null;
  if (snapshot.observedAt) {
    const at = Date.parse(snapshot.observedAt);
    if (Number.isFinite(at)) ageMs = Math.max(0, nowMs - at);
  }
  const feedFresh = ageMs != null && ageMs <= PITPAL_MONITOR_STALE_MS;
  return NextResponse.json({
    ...snapshot,
    monitor: {
      status: monitor.status === "unknown" ? (feedFresh ? "online" : "offline") : monitor.status,
      ageMs,
      staleMs: PITPAL_MONITOR_STALE_MS,
      lastCheckedAt: monitor.lastCheckedAt,
      offlineSince: monitor.offlineSince,
      lastAlertAt: monitor.lastAlertAt,
    },
  });
}

/**
 * Tampermonkey ingest from https://pitpal.rocks/admin/lobbies
 * Body: { observedAt?, source?, players: [{ name, lobbyName, location, armorType, killStreak, isNicked }] }
 */
export async function POST(request: Request) {
  const limit = rateLimiter.check(clientIp(request));
  if (!limit.allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }
  if (!isUsingPostgres()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL required." }, { status: 503 });
  }
  const db = getDatabase();
  if (!db) {
    return NextResponse.json({ ok: false, error: "Database unavailable." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON body required." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "Invalid body." }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  if (!Array.isArray(input.players)) {
    return NextResponse.json({ ok: false, error: "players[] is required." }, { status: 400 });
  }

  try {
    const result = await ingestPitpalLobbies(db, {
      observedAt: typeof input.observedAt === "string" ? input.observedAt : null,
      source: typeof input.source === "string" ? input.source : "pitpal_tampermonkey",
      players: input.players,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingest failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
