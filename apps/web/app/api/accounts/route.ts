import { NextResponse } from "next/server";
import { getAccountsRepository, isUsingPostgres } from "../../../src/server/runtime";

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
  if (!repo) {
    return NextResponse.json({ error: "Accounts repository unavailable." }, { status: 503 });
  }

  const accounts = await repo.list();
  return NextResponse.json({ accounts });
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

  try {
    const account = await repo.create({
      mcUsername,
      mcUuid:
        body !== null &&
        typeof body === "object" &&
        "mcUuid" in body &&
        typeof (body as { mcUuid: unknown }).mcUuid === "string"
          ? (body as { mcUuid: string }).mcUuid
          : null,
      displayName:
        body !== null &&
        typeof body === "object" &&
        "displayName" in body &&
        typeof (body as { displayName: unknown }).displayName === "string"
          ? (body as { displayName: string }).displayName
          : null,
      enabled:
        body !== null &&
        typeof body === "object" &&
        "enabled" in body &&
        typeof (body as { enabled: unknown }).enabled === "boolean"
          ? (body as { enabled: boolean }).enabled
          : true,
    });
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create account.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
