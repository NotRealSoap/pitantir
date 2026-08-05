import { NextResponse } from "next/server";
import {
  addSuspiciousManualNode,
  listSuspiciousItems,
  markSuspiciousItem,
  removeSuspiciousManualNode,
  unmarkSuspiciousItem,
  type SuspiciousNumeralStyle,
} from "@pitantir/db";
import { getDatabase, isUsingPostgres } from "../../../src/server/runtime";

export async function GET(request: Request) {
  if (!isUsingPostgres()) {
    return NextResponse.json({ error: "Requires DATABASE_URL." }, { status: 503 });
  }
  const db = getDatabase();
  if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });

  const url = new URL(request.url);
  const nonce = url.searchParams.get("nonce")?.trim();
  const items = await listSuspiciousItems(db);
  return NextResponse.json({
    items: nonce ? items.filter((item) => item.nonce === nonce) : items,
  });
}

export async function POST(request: Request) {
  if (!isUsingPostgres()) {
    return NextResponse.json({ error: "Requires DATABASE_URL." }, { status: 503 });
  }
  const db = getDatabase();
  if (!db) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });

  const body = (await request.json()) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "mark") {
      const nonce = typeof body.nonce === "string" ? body.nonce : "";
      const numeralStyle: SuspiciousNumeralStyle =
        body.numeralStyle === "roman" ? "roman" : "arabic";
      const item = await markSuspiciousItem(db, {
        nonce,
        title: typeof body.title === "string" ? body.title : null,
        numeralStyle,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      });
      return NextResponse.json({ ok: true, item, items: await listSuspiciousItems(db) });
    }
    if (action === "unmark") {
      const id = typeof body.id === "string" ? body.id : "";
      const removed = await unmarkSuspiciousItem(db, id);
      return NextResponse.json({ ok: removed, items: await listSuspiciousItems(db) });
    }
    if (action === "add_node") {
      const item = await addSuspiciousManualNode(db, {
        itemId: typeof body.itemId === "string" ? body.itemId : "",
        mcUsername: typeof body.mcUsername === "string" ? body.mcUsername : "",
        at: typeof body.at === "string" ? body.at : undefined,
        note: typeof body.note === "string" ? body.note : null,
      });
      if (!item) return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });
      return NextResponse.json({ ok: true, item, items: await listSuspiciousItems(db) });
    }
    if (action === "remove_node") {
      const item = await removeSuspiciousManualNode(db, {
        itemId: typeof body.itemId === "string" ? body.itemId : "",
        nodeId: typeof body.nodeId === "string" ? body.nodeId : "",
      });
      if (!item) return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });
      return NextResponse.json({ ok: true, item, items: await listSuspiciousItems(db) });
    }
    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Request failed." },
      { status: 400 },
    );
  }
}
