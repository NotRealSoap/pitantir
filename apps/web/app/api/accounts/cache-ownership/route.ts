import { NextResponse } from "next/server";
import { cachePitPandaOwnershipForAccounts } from "../../../../src/server/cache-account-ownership";
import { ItemSearchError } from "@pitantir/shared/item-data";
import type { PublicAccount } from "@pitantir/db";
import {
  getAccountHistoryItemProvider,
  getAccountsRepository,
  getLocalOwnershipEnricher,
  getPitPandaOwnershipIngestor,
  getUpstreamIngestor,
  isUsingPostgres,
} from "../../../../src/server/runtime";

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

export async function POST(request: Request) {
  if (!isUsingPostgres()) {
    return NextResponse.json(
      { error: "Caching ownership requires DATABASE_URL." },
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

  const accountIds =
    body !== null &&
    typeof body === "object" &&
    "accountIds" in body &&
    Array.isArray((body as { accountIds: unknown }).accountIds)
      ? (body as { accountIds: unknown[] }).accountIds.filter(
          (id): id is string => typeof id === "string" && id.trim() !== "",
        )
      : [];

  const usernames =
    body !== null &&
    typeof body === "object" &&
    "usernames" in body &&
    Array.isArray((body as { usernames: unknown }).usernames)
      ? (body as { usernames: unknown[] }).usernames
          .filter((name): name is string => typeof name === "string")
          .map((name) => name.trim())
          .filter((name) => name !== "")
      : [];

  if (accountIds.length === 0 && usernames.length === 0) {
    return NextResponse.json(
      { error: "Provide accountIds and/or usernames to cache." },
      { status: 400 },
    );
  }
  if (accountIds.length + usernames.length > 25) {
    return NextResponse.json({ error: "Cache at most 25 accounts per request." }, { status: 400 });
  }

  const selected: PublicAccount[] = [];
  const seen = new Set<string>();

  for (const id of accountIds) {
    const account = await repo.get(id);
    if (!account) {
      return NextResponse.json({ error: `Account not found: ${id}` }, { status: 404 });
    }
    if (!seen.has(account.id)) {
      seen.add(account.id);
      selected.push(account);
    }
  }

  for (const username of usernames) {
    if (!USERNAME_RE.test(username)) {
      return NextResponse.json(
        { error: `Invalid Minecraft username: ${username}` },
        { status: 400 },
      );
    }
    let account = await repo.getByUsername(username);
    if (!account) {
      // Case-insensitive search (DB unique index is lower(username)).
      const listed = await repo.list();
      account =
        listed.find((row) => row.mcUsername.toLowerCase() === username.toLowerCase()) ?? null;
    }
    if (!account) {
      account = await repo.create({
        mcUsername: username,
        enabled: false,
        watchlisted: false,
        notes: "auto:cache-ownership",
      });
    }
    if (!seen.has(account.id)) {
      seen.add(account.id);
      selected.push(account);
    }
  }

  try {
    const result = await cachePitPandaOwnershipForAccounts(selected, {
      provider: getAccountHistoryItemProvider(),
      ingestor: await getUpstreamIngestor(),
      enricher: await getLocalOwnershipEnricher(),
      ownershipIngestor: await getPitPandaOwnershipIngestor(),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ItemSearchError && error.code === "configuration_error") {
      return NextResponse.json(
        { error: "PitPanda is not configured. Set PITPANDA_API_KEY (or configure in Settings)." },
        { status: 503 },
      );
    }
    const message = error instanceof Error ? error.message : "Unable to cache ownership.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
