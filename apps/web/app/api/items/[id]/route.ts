import { NextResponse } from "next/server";
import { getCatalogRepository, isUsingPostgres } from "../../../../src/server/runtime";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  if (!isUsingPostgres()) {
    return NextResponse.json({ error: "Items require DATABASE_URL." }, { status: 503 });
  }
  const catalog = await getCatalogRepository();
  if (!catalog) {
    return NextResponse.json({ error: "Catalog unavailable." }, { status: 503 });
  }

  const { id } = await context.params;
  const detail = await catalog.getItemDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  }
  return NextResponse.json({ item: detail });
}
