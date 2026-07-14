import { NextResponse } from "next/server";
import { ItemSearchError } from "@pitantir/shared/item-data";
import {
  getAccountHistoryItemProvider,
  getCatalogRepository,
  getPitPandaOwnershipIngestor,
  isUsingPostgres,
} from "../../../../src/server/runtime";
import { syncPitPandaOwnershipByNonce } from "../../../../src/server/sync-pitpanda-ownership";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  if (!isUsingPostgres()) {
    return NextResponse.json({ error: "Items require DATABASE_URL." }, { status: 503 });
  }
  const catalog = await getCatalogRepository();
  if (!catalog) {
    return NextResponse.json({ error: "Catalog unavailable." }, { status: 503 });
  }

  const { id } = await context.params;
  let detail = await catalog.getItemDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  }

  // Best-effort: pull PitPanda owners for this nonce into local history (same source PitPal uses).
  const url = new URL(request.url);
  const syncParam = url.searchParams.get("syncPitPanda");
  const alreadyImported = detail.events.some(
    (event) =>
      event.eventType === "import_presence" ||
      (event.payload &&
        typeof event.payload === "object" &&
        (event.payload as Record<string, unknown>).source === "pitpanda"),
  );
  const shouldSync =
    syncParam === "1" || (syncParam !== "0" && !alreadyImported);
  let ownershipSync: Awaited<ReturnType<typeof syncPitPandaOwnershipByNonce>> | null = null;

  if (shouldSync && detail.item.primaryNonce) {
    try {
      const ownershipIngestor = await getPitPandaOwnershipIngestor();
      if (ownershipIngestor) {
        ownershipSync = await syncPitPandaOwnershipByNonce(
          {
            provider: getAccountHistoryItemProvider(),
            ownershipIngestor,
          },
          {
            canonicalItemId: detail.item.id,
            nonce: detail.item.primaryNonce,
          },
        );
        if (ownershipSync.eventsCreated > 0 || ownershipSync.periodsCreated > 0) {
          detail = (await catalog.getItemDetail(id)) ?? detail;
        }
      }
    } catch (error) {
      if (!(error instanceof ItemSearchError && error.code === "configuration_error")) {
        ownershipSync = {
          attempted: true,
          eventsCreated: 0,
          periodsCreated: 0,
          skippedOwnersWithoutUsername: 0,
          message: error instanceof Error ? error.message : "PitPanda sync failed.",
        };
      }
    }
  }

  return NextResponse.json({
    item: detail,
    ownershipSync,
  });
}
