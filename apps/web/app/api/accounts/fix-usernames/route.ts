import { NextResponse } from "next/server";
import {
  getAccountsRepository,
  isUsingPostgres,
} from "../../../../src/server/runtime";
import { fixAccountUsernames } from "../../../../src/server/fix-account-usernames";

/**
 * POST /api/accounts/fix-usernames
 * Body: { scope?: "watchlist" | "contacts" | "all"; accountIds?: string[] }
 *
 * Mojang-resolves each selected account and writes correct IGN casing + UUID.
 * Does not call Hypixel (no scan quota).
 */
export async function POST(request: Request) {
  if (!isUsingPostgres()) {
    return NextResponse.json(
      { error: "Fixing usernames requires DATABASE_URL." },
      { status: 503 },
    );
  }

  const repo = await getAccountsRepository();
  if (!repo) {
    return NextResponse.json({ error: "Accounts repository unavailable." }, { status: 503 });
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text);
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

  const scopeRaw =
    body !== null &&
    typeof body === "object" &&
    "scope" in body &&
    typeof (body as { scope: unknown }).scope === "string"
      ? (body as { scope: string }).scope
      : "watchlist";

  if (!["watchlist", "contacts", "all"].includes(scopeRaw) && accountIds.length === 0) {
    return NextResponse.json(
      { error: 'scope must be "watchlist", "contacts", or "all".' },
      { status: 400 },
    );
  }

  const scope = scopeRaw as "watchlist" | "contacts" | "all";

  try {
    const result = await fixAccountUsernames({
      listAccounts: async () => {
        if (scope === "watchlist") return repo.listWatchlist();
        if (scope === "contacts") return repo.listOwnershipContacts();
        return repo.list();
      },
      getAccount: (id) => repo.get(id),
      updateAccount: (id, patch) => repo.update(id, patch),
    }, accountIds.length > 0 ? { accountIds } : {});

    return NextResponse.json({
      ...result,
      // Keep response small for UI note; full changed rows still included.
      message: `Checked ${result.checked}: updated ${result.updated}, unchanged ${result.unchanged}, failed ${result.failed}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to fix usernames.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
