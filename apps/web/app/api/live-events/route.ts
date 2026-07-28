import { NextResponse } from "next/server";
import { getHypixelLiveEvents } from "@pitantir/db";
import { getDatabase, isUsingPostgres } from "../../../src/server/runtime";

/**
 * Full newsworthy event feed for the Events page.
 * Excludes routine `scanned` heartbeat rows unless ?all=1.
 */
export async function GET(request: Request) {
  if (!isUsingPostgres()) {
    return NextResponse.json(
      { error: "Live events require DATABASE_URL." },
      { status: 503 },
    );
  }

  const db = getDatabase();
  if (!db) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const url = new URL(request.url);
  const includeScanned = url.searchParams.get("all") === "1";
  const kind = url.searchParams.get("kind");
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(limitRaw) ? Math.min(250, Math.max(1, Math.trunc(limitRaw))) : 200;

  const events = await getHypixelLiveEvents(db);
  const filtered = events.filter((event) => {
    if (!includeScanned && event.kind === "scanned") return false;
    if (kind && event.kind !== kind) return false;
    return true;
  });

  return NextResponse.json({
    events: filtered.slice(0, limit),
    total: filtered.length,
    polledAt: new Date().toISOString(),
  });
}
