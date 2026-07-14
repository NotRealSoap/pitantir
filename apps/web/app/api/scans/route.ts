import { NextResponse } from "next/server";
import { getCatalogRepository, isUsingPostgres } from "../../../src/server/runtime";

export async function GET(request: Request) {
  if (!isUsingPostgres()) {
    return NextResponse.json({ error: "Scans require DATABASE_URL." }, { status: 503 });
  }
  const catalog = await getCatalogRepository();
  if (!catalog) {
    return NextResponse.json({ error: "Catalog unavailable." }, { status: 503 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 100) || 100;
  const scans = await catalog.listScansWithAccounts(limit);
  return NextResponse.json({ scans });
}
