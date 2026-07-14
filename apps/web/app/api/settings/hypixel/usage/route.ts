import { NextResponse } from "next/server";
import {
  appendHypixelApiCall,
  getHypixelRateLimitSnapshot,
  setHypixelRateLimitSnapshot,
} from "@pitantir/db";
import { randomUUID } from "node:crypto";
import {
  getAccountsRepository,
  getDatabase,
  isUsingPostgres,
} from "../../../../../src/server/runtime";
import { getHypixelApiKey, isHypixelConfigured } from "../../../../../src/server/hypixel-key-store";
import {
  buildHypixelUsageView,
  probeHypixelRateLimit,
} from "../../../../../src/server/hypixel-usage";
import { InMemoryRateLimiter } from "../../../../../src/server/rate-limit";

const rateLimiter = new InMemoryRateLimiter(20, 60_000);

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "anonymous"
  );
}

async function usagePayload() {
  const configured = isHypixelConfigured();
  const repo = await getAccountsRepository();
  const db = getDatabase();
  if (!isUsingPostgres() || !db || !repo) {
    return {
      configured,
      snapshot: null,
      used: null,
      resetAt: null,
      secondsUntilReset: null,
      stale: false,
      watchlistCount: 0,
      refreshingCount: 0,
      currentIntervalSeconds: null,
      recommendedIntervalSeconds: null,
      estimatedRequestsPerWindow: null,
      estimatedBudgetPerWindow: null,
      databaseReady: false,
    };
  }

  const [snapshot, watchlist] = await Promise.all([
    getHypixelRateLimitSnapshot(db),
    repo.listWatchlist(),
  ]);
  return {
    ...buildHypixelUsageView({ configured, snapshot, watchlist }),
    databaseReady: true,
  };
}

/** Latest observed Hypixel quota + recommended scan pacing. */
export async function GET() {
  return NextResponse.json(await usagePayload());
}

/**
 * POST actions:
 * - { action: "probe" } — spend 1 request to refresh RateLimit headers
 * - { action: "apply_recommended_interval" } — set watch-list scan intervals to recommendation
 * - { action: "set_interval", scanIntervalSeconds: number } — set a custom interval for the watch list
 */
export async function POST(request: Request) {
  const limit = rateLimiter.check(clientIp(request));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429 },
    );
  }

  if (!isUsingPostgres()) {
    return NextResponse.json({ error: "DATABASE_URL is required." }, { status: 503 });
  }

  const repo = await getAccountsRepository();
  const db = getDatabase();
  if (!db || !repo) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const action =
    body !== null &&
    typeof body === "object" &&
    "action" in body &&
    typeof (body as { action: unknown }).action === "string"
      ? (body as { action: string }).action
      : "probe";

  try {
    if (action === "probe") {
      const apiKey = getHypixelApiKey();
      if (!apiKey) {
        return NextResponse.json({ error: "Hypixel API key is not configured." }, { status: 400 });
      }
      const previous = await getHypixelRateLimitSnapshot(db);
      const snapshot = await probeHypixelRateLimit({
        apiKey,
        previousWindowSeconds: previous?.windowSeconds ?? null,
      });
      await setHypixelRateLimitSnapshot(db, snapshot);
      await appendHypixelApiCall(db, {
        id: randomUUID(),
        at: new Date().toISOString(),
        endpoint: "punishmentstats",
        accountId: null,
        mcUsername: null,
        ok: true,
        statusCode: 200,
        detail: "quota probe",
      }).catch(() => undefined);
      return NextResponse.json({
        ok: true,
        message: "Quota refreshed from Hypixel RateLimit headers.",
        ...(await usagePayload()),
      });
    }

    if (action === "rebalance_schedule") {
      const updated = await repo.rebalanceWatchlistSchedule();
      return NextResponse.json({
        ok: true,
        message: `Staggered next-scan times across the interval for ${updated} watch-list account(s).`,
        updated,
        ...(await usagePayload()),
      });
    }

    if (action === "apply_recommended_interval" || action === "set_interval") {
      let seconds: number;
      if (action === "set_interval") {
        const raw =
          body !== null &&
          typeof body === "object" &&
          "scanIntervalSeconds" in body &&
          typeof (body as { scanIntervalSeconds: unknown }).scanIntervalSeconds === "number"
            ? (body as { scanIntervalSeconds: number }).scanIntervalSeconds
            : NaN;
        if (!Number.isFinite(raw)) {
          return NextResponse.json({ error: "scanIntervalSeconds is required." }, { status: 400 });
        }
        seconds = Math.floor(raw);
      } else {
        const view = await usagePayload();
        if (view.recommendedIntervalSeconds == null) {
          return NextResponse.json(
            {
              error:
                "No quota snapshot yet. Click “Refresh quota” first (or run a scan) so a recommendation can be computed.",
            },
            { status: 400 },
          );
        }
        seconds = view.recommendedIntervalSeconds;
      }

      const updated = await repo.setWatchlistScanInterval(seconds);
      return NextResponse.json({
        ok: true,
        message: `Updated scan interval to every ${seconds}s for ${updated} watch-list account(s).`,
        scanIntervalSeconds: seconds,
        updated,
        ...(await usagePayload()),
      });
    }

    return NextResponse.json(
      {
        error:
          'Unknown action. Use "probe", "rebalance_schedule", "apply_recommended_interval", or "set_interval".',
      },
      { status: 400 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update Hypixel usage.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
