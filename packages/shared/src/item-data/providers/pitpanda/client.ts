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

interface PitPandaSuccessBody {
  success: true;
  items: unknown[];
}

interface PitPandaFailureBody {
  success: false;
  error?: string;
}

type PitPandaBody = PitPandaSuccessBody | PitPandaFailureBody;

export interface PitPandaSearchResult {
  items: unknown[];
  page: number;
}

const DEFAULT_BASE_URL = "https://pitpanda.rocks/api";

export async function pitPandaItemSearch(
  options: PitPandaClientOptions,
  query: string,
  page: number,
): Promise<PitPandaSearchResult> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRetries = options.maxRetries ?? 3;
  const fetchImpl = options.fetchImpl ?? fetch;

  const url = new URL(`${baseUrl}/itemSearch/${encodeURIComponent(query)}`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("sort", "-lastseen");

  let attempt = 0;
  while (attempt < maxRetries) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          "X-API-Key": options.apiKey,
          Accept: "application/json",
        },
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

      if (!response.ok) {
        throw new ItemSearchError("upstream_unavailable", "Upstream provider request failed");
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new ItemSearchError("upstream_unavailable", "Upstream provider returned non-JSON response");
      }

      let body: PitPandaBody;
      try {
        body = (await response.json()) as PitPandaBody;
      } catch {
        throw new ItemSearchError("upstream_unavailable", "Upstream provider returned invalid JSON");
      }

      if (!body.success) {
        const message = "error" in body && body.error ? body.error : "Upstream search failed";
        throw new ItemSearchError("upstream_unavailable", message);
      }

      const items = Array.isArray(body.items) ? body.items : [];
      return { items, page };
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
