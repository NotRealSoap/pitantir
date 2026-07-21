import { NextResponse } from "next/server";
import {
  getAccountHistoryService,
  getAccountsRepository,
  isUsingPostgres,
} from "../../../../src/server/runtime";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  if (!isUsingPostgres()) {
    return NextResponse.json({ error: "Accounts require DATABASE_URL." }, { status: 503 });
  }

  const { id } = await context.params;
  const historyService = await getAccountHistoryService();
  if (!historyService) {
    return NextResponse.json({ error: "Account history unavailable." }, { status: 503 });
  }

  const history = await historyService.getHistory(id);
  if (!history) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  return NextResponse.json({ history });
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!isUsingPostgres()) {
    return NextResponse.json({ error: "Accounts require DATABASE_URL." }, { status: 503 });
  }
  const repo = await getAccountsRepository();
  if (!repo) {
    return NextResponse.json({ error: "Accounts repository unavailable." }, { status: 503 });
  }

  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  try {
    const account = await repo.update(id, {
      ...(body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {}),
    } as {
      mcUsername?: string;
      displayName?: string | null;
      enabled?: boolean;
      watchlisted?: boolean;
      scanIntervalSeconds?: number;
      notes?: string | null;
    });
    return NextResponse.json({ account });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update account.";
    const status = message === "Account not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  if (!isUsingPostgres()) {
    return NextResponse.json({ error: "Accounts require DATABASE_URL." }, { status: 503 });
  }
  const repo = await getAccountsRepository();
  if (!repo) {
    return NextResponse.json({ error: "Accounts repository unavailable." }, { status: 503 });
  }

  const { id } = await context.params;
  try {
    await repo.softDelete(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete account.";
    const status = message === "Account not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
