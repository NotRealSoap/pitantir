import { NextResponse } from "next/server";
import { getHypixelScansPaused, setHypixelScansPaused } from "@pitantir/db";
import { getDatabase, isUsingPostgres } from "../../../src/server/runtime";

/** Global Hypixel refresh pause — protects API quota without leaving the watch list. */
export async function GET() {
  if (!isUsingPostgres()) {
    return NextResponse.json({ error: "DATABASE_URL required." }, { status: 503 });
  }
  const db = getDatabase();
  if (!db) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }
  return NextResponse.json({ paused: await getHypixelScansPaused(db) });
}

export async function POST(request: Request) {
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

  if (
    body === null ||
    typeof body !== "object" ||
    !("paused" in body) ||
    typeof (body as { paused: unknown }).paused !== "boolean"
  ) {
    return NextResponse.json({ error: "paused (boolean) is required." }, { status: 400 });
  }

  const paused = (body as { paused: boolean }).paused;
  await setHypixelScansPaused(db, paused);
  return NextResponse.json({ paused });
}
