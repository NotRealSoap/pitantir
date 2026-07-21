import { NextResponse } from "next/server";
import { getCatalogRepository, isUsingPostgres } from "../../../src/server/runtime";

export async function GET(request: Request) {
  if (!isUsingPostgres()) {
    return NextResponse.json({ error: "Items require DATABASE_URL." }, { status: 503 });
  }
  const catalog = await getCatalogRepository();
  if (!catalog) {
    return NextResponse.json({ error: "Catalog unavailable." }, { status: 503 });
  }

  const url = new URL(request.url);
  const location = url.searchParams.get("location");
  const items = await catalog.listItems({
    nonce: url.searchParams.get("nonce") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    confidence: url.searchParams.get("confidence") ?? undefined,
    location:
      location === "known" || location === "unknown" || location === "any"
        ? location
        : "any",
    q: url.searchParams.get("q") ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? 100) || 100,
  });

  return NextResponse.json({ items });
}
