import { NextResponse } from "next/server";
import { getScanScheduler, isUsingPostgres } from "../../../../../src/server/runtime";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  if (!isUsingPostgres()) {
    return NextResponse.json({ error: "Scan now requires DATABASE_URL." }, { status: 503 });
  }
  const scheduler = await getScanScheduler();
  if (!scheduler) {
    return NextResponse.json({ error: "Scheduler unavailable." }, { status: 503 });
  }

  const { id } = await context.params;
  try {
    const result = await scheduler.enqueueManualScan(id);
    return NextResponse.json({
      jobId: result.jobId,
      created: result.created,
      message: "Scan job enqueued. Ensure the worker is running.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to enqueue scan.";
    const status =
      message === "Account not found" ? 404 : message === "Account is disabled" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
