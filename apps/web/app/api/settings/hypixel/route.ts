import { NextResponse } from "next/server";
import {
  getHypixelApiKey,
  isHypixelConfigured,
  setHypixelApiKey,
} from "../../../../src/server/hypixel-key-store";
import { InMemoryRateLimiter } from "../../../../src/server/rate-limit";

const rateLimiter = new InMemoryRateLimiter(10, 60_000);

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "anonymous"
  );
}

/** Never returns the key value — only whether it is present. */
export async function GET() {
  return NextResponse.json({
    configured: isHypixelConfigured(),
    inventorySource: process.env.INVENTORY_SOURCE ?? (isHypixelConfigured() ? "hypixel_pit" : "mock"),
  });
}

export async function POST(request: Request) {
  const limit = rateLimiter.check(clientIp(request));
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Try again shortly." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }

  const apiKey =
    body !== null &&
    typeof body === "object" &&
    "apiKey" in body &&
    typeof (body as { apiKey: unknown }).apiKey === "string"
      ? (body as { apiKey: string }).apiKey
      : null;

  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "apiKey is required." }, { status: 400 });
  }

  try {
    await setHypixelApiKey(apiKey);
    return NextResponse.json({
      ok: true,
      configured: Boolean(getHypixelApiKey()),
      inventorySource: "hypixel_pit",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save API key.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
