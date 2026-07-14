import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("../../../src/server/runtime", () => ({
  getAccountHistoryItemProvider: vi.fn(),
  getUpstreamIngestor: vi.fn(),
  getLocalOwnershipEnricher: vi.fn(),
}));

import {
  getAccountHistoryItemProvider,
  getLocalOwnershipEnricher,
  getUpstreamIngestor,
} from "../../../src/server/runtime";
import { ItemSearchError } from "@pitantir/shared/item-data";
import { IdentityService, MemoryIdentityStore, UpstreamObservationIngestor } from "@pitantir/db";
import { ACCOUNT_HISTORY_LIMITS } from "@pitantir/shared/account-history";

describe("POST /api/account-history", () => {
  beforeEach(() => {
    vi.mocked(getUpstreamIngestor).mockResolvedValue(
      new UpstreamObservationIngestor(new IdentityService(new MemoryIdentityStore())),
    );
    vi.mocked(getLocalOwnershipEnricher).mockResolvedValue(null);
  });

  it("returns invalid_input for malformed JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/account-history", {
        method: "POST",
        body: "not-json",
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.status).toBe("invalid_input");
  });

  it("returns invalid_input for invalid request schema", async () => {
    const response = await POST(
      new Request("http://localhost/api/account-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: "" }),
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.status).toBe("invalid_input");
  });

  it("returns configuration_error when provider is not configured", async () => {
    vi.mocked(getAccountHistoryItemProvider).mockImplementation(() => {
      throw new ItemSearchError(
        "configuration_error",
        "Search is not configured on the server.",
      );
    });

    const response = await POST(
      new Request("http://localhost/api/account-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: "Notch" }),
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(503);
    expect(payload.status).toBe("configuration_error");
    expect(JSON.stringify(payload)).not.toMatch(/api[_-]?key/i);
  });

  it("rate limits after ACCOUNT_HISTORY_LIMITS.routeLimit", async () => {
    vi.mocked(getAccountHistoryItemProvider).mockImplementation(() => {
      throw new ItemSearchError("configuration_error", "not configured");
    });

    let limited = false;
    for (let i = 0; i < ACCOUNT_HISTORY_LIMITS.routeLimit + 2; i += 1) {
      const response = await POST(
        new Request("http://localhost/api/account-history", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": "203.0.113.50",
          },
          body: JSON.stringify({ account: "Notch" }),
        }),
      );
      if (response.status === 429) {
        limited = true;
        const payload = await response.json();
        expect(payload.status).toBe("rate_limited");
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
