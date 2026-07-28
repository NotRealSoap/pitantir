import { NextResponse } from "next/server";
import { syncFurryStashesWatchlist } from "@pitantir/db";
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

/**
 * Tampermonkey ingest from https://pitpal.rocks/admin/furry-stashes
 * Body: { observedAt?, source?, entries: [{ username, notes, is140er? }] }
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
  const entries = Array.isArray(input.entries)
    ? input.entries
    : Array.isArray(input.players)
      ? input.players
      : null;
  if (!entries) {
    return NextResponse.json(
      { ok: false, error: "entries[] (or players[]) is required." },
      { status: 400 },
    );
  }

  try {
    const result = await syncFurryStashesWatchlist(db, {
      observedAt: typeof input.observedAt === "string" ? input.observedAt : null,
      source: typeof input.source === "string" ? input.source : "pitpal_furry_stashes",
      entries,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
