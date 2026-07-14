import { ItemSearchError } from "../../types.js";

export class PitPandaHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PitPandaHttpError";
  }
}

export interface PitPandaClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

interface PitPandaSearchSuccessBody {
  success: true;
  items: unknown[];
}

interface PitPandaItemSuccessBody {
  success: true;
  item: unknown;
}

interface PitPandaFailureBody {
  success: false;
  error?: string;
}

type PitPandaSearchBody = PitPandaSearchSuccessBody | PitPandaFailureBody;
type PitPandaItemBody = PitPandaItemSuccessBody | PitPandaFailureBody;

export interface PitPandaSearchResult {
  items: unknown[];
  page: number;
}

export interface PitPandaItemResult {
  item: Record<string, unknown>;
}

const DEFAULT_BASE_URL = "https://pitpanda.rocks/api";

export async function pitPandaItemSearch(
  options: PitPandaClientOptions,
  query: string,
  page: number,
): Promise<PitPandaSearchResult> {
  const body = await pitPandaGetJson<PitPandaSearchBody>(options, `/itemSearch/${encodeURIComponent(query)}`, {
    page: String(page),
    sort: "-lastseen",
    // Default search mapping (dbToItem) strips `owners` and renames `_id` → `id`.
    // Raw mystic docs keep the ownership timeline we need for import.
    raw: "true",
  });

  if (!body.success) {
    const message = "error" in body && body.error ? body.error : "Upstream search failed";
    throw new ItemSearchError("upstream_unavailable", message);
  }

  return { items: Array.isArray(body.items) ? body.items : [], page };
}

/**
 * Fetch a single PitPanda item by Mongo `_id`.
 * Detail responses include `owners: [{ uuid, time }]` ownership timeline.
 */
export async function pitPandaGetItem(
  options: PitPandaClientOptions,
  itemId: string,
): Promise<PitPandaItemResult> {
  const trimmed = itemId.trim();
  if (!/^[a-f0-9]{24}$/i.test(trimmed)) {
    throw new ItemSearchError("invalid_search", "Invalid PitPanda item id");
  }

  const body = await pitPandaGetJson<PitPandaItemBody>(
    options,
    `/item/${encodeURIComponent(trimmed)}`,
  );

  if (!body.success) {
    const message = "error" in body && body.error ? body.error : "Upstream item lookup failed";
    throw new ItemSearchError("upstream_unavailable", message);
  }

  if (!body.item || typeof body.item !== "object" || Array.isArray(body.item)) {
    throw new ItemSearchError("upstream_unavailable", "Upstream item payload missing");
  }

  return { item: body.item as Record<string, unknown> };
}

async function pitPandaGetJson<T>(
  options: PitPandaClientOptions,
  path: string,
  query?: Record<string, string>,
): Promise<T> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRetries = options.maxRetries ?? 3;
  const fetchImpl = options.fetchImpl ?? fetch;

  const url = new URL(`${baseUrl}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  let attempt = 0;
  while (attempt < maxRetries) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (options.apiKey) {
        headers["X-API-Key"] = options.apiKey;
      }

      const response = await fetchImpl(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new ItemSearchError("upstream_unauthorized", "Upstream provider rejected credentials");
      }

      if (response.status === 429) {
        if (attempt >= maxRetries) {
          throw new ItemSearchError("upstream_rate_limited", "Upstream provider rate limit exceeded");
        }
        await sleep(backoffMs(attempt));
        continue;
      }

      if (response.status === 404) {
        throw new ItemSearchError("no_results", "Upstream item not found");
      }

      if (!response.ok) {
        throw new ItemSearchError("upstream_unavailable", "Upstream provider request failed");
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new ItemSearchError("upstream_unavailable", "Upstream provider returned non-JSON response");
      }

      try {
        return (await response.json()) as T;
      } catch {
        throw new ItemSearchError("upstream_unavailable", "Upstream provider returned invalid JSON");
      }
    } catch (error) {
      if (error instanceof ItemSearchError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new ItemSearchError("upstream_unavailable", "Upstream provider request timed out");
      }
      if (attempt >= maxRetries) {
        throw new ItemSearchError("upstream_unavailable", "Upstream provider request failed");
      }
      await sleep(backoffMs(attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new ItemSearchError("upstream_unavailable", "Upstream provider request failed");
}

function backoffMs(attempt: number): number {
  return Math.min(250 * 2 ** (attempt - 1), 2_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
