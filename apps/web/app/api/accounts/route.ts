import { NextResponse } from "next/server";
import {
  getAccountsRepository,
  getDatabase,
  isUsingPostgres,
} from "../../../src/server/runtime";
import { getHypixelScansPaused } from "@pitantir/db";

function explainAccountError(message: string): string {
  // Drizzle wraps every insert failure as "Failed query: insert ... watchlisted ..."
  // Do NOT treat that as a missing-column migration problem.
  if (/column ["']?watchlisted["']? does not exist/i.test(message)) {
    return "Database is missing the watchlist column. Run: npx pnpm@10.11.0 db:migrate";
  }
  if (/duplicate key|unique constraint|already exists/i.test(message)) {
    return "That Minecraft username (or UUID) is already in the database. Check Ownership contacts and use “Add to watch list”, or pick another IGN.";
  }
  return message;
}

export async function GET() {
  if (!isUsingPostgres()) {
    return NextResponse.json(
      {
        error:
          "Accounts require DATABASE_URL. Set DATABASE_URL in apps/web/.env.local and restart.",
      },
      { status: 503 },
    );
  }

  const repo = await getAccountsRepository();
  const db = getDatabase();
  if (!repo || !db) {
    return NextResponse.json({ error: "Accounts repository unavailable." }, { status: 503 });
  }

  const [watchlist, contacts, scansPaused] = await Promise.all([
    repo.listWatchlist(),
    repo.listOwnershipContacts(),
    getHypixelScansPaused(db),
  ]);

  return NextResponse.json({
    watchlist,
    contacts,
    accounts: [...watchlist, ...contacts],
    scansPaused,
  });
}

export async function POST(request: Request) {
  if (!isUsingPostgres()) {
    return NextResponse.json(
      { error: "Accounts require DATABASE_URL." },
      { status: 503 },
    );
  }

  const repo = await getAccountsRepository();
  if (!repo) {
    return NextResponse.json({ error: "Accounts repository unavailable." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const mcUsername =
    body !== null &&
    typeof body === "object" &&
    "mcUsername" in body &&
    typeof (body as { mcUsername: unknown }).mcUsername === "string"
      ? (body as { mcUsername: string }).mcUsername
      : null;

  if (!mcUsername) {
    return NextResponse.json({ error: "mcUsername is required." }, { status: 400 });
  }

  const watchlisted =
    body !== null &&
    typeof body === "object" &&
    "watchlisted" in body &&
    typeof (body as { watchlisted: unknown }).watchlisted === "boolean"
      ? (body as { watchlisted: boolean }).watchlisted
      : true;

  const mcUuid =
    body !== null &&
    typeof body === "object" &&
    "mcUuid" in body &&
    typeof (body as { mcUuid: unknown }).mcUuid === "string"
      ? (body as { mcUuid: string }).mcUuid
      : null;

  const displayName =
    body !== null &&
    typeof body === "object" &&
    "displayName" in body &&
    typeof (body as { displayName: unknown }).displayName === "string"
      ? (body as { displayName: string }).displayName
      : null;

  try {
    // Watch-list adds: create OR promote an existing ownership contact.
    if (watchlisted) {
      const result = await repo.ensureOnWatchlist({
        mcUsername,
        mcUuid,
        displayName,
      });
      return NextResponse.json(
        {
          account: result.account,
          created: result.created,
          promoted: result.promoted,
        },
        { status: result.created ? 201 : 200 },
      );
    }

    const account = await repo.create({
      mcUsername,
      mcUuid,
      displayName,
      enabled: false,
      watchlisted: false,
      notes: "manual:ownership-contact",
    });
    return NextResponse.json({ account, created: true, promoted: false }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create account.";
    return NextResponse.json({ error: explainAccountError(message) }, { status: 400 });
  }
}
