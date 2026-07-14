import { NextResponse } from "next/server";
import { cachePitPandaOwnershipForAccounts } from "../../../../src/server/cache-account-ownership";
import { ItemSearchError } from "@pitantir/shared/item-data";
import {
  getAccountHistoryItemProvider,
  getAccountsRepository,
  getLocalOwnershipEnricher,
  getPitPandaOwnershipIngestor,
  getUpstreamIngestor,
  isUsingPostgres,
} from "../../../../src/server/runtime";

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

  if (accountIds.length === 0) {
    return NextResponse.json({ error: "Select at least one account (accountIds)." }, { status: 400 });
  }
  if (accountIds.length > 25) {
    return NextResponse.json({ error: "Cache at most 25 accounts per request." }, { status: 400 });
  }

  const selected = [];
  for (const id of accountIds) {
    const account = await repo.get(id);
    if (!account) {
      return NextResponse.json({ error: `Account not found: ${id}` }, { status: 404 });
    }
    selected.push(account);
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
