import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("../../../src/server/runtime", () => ({
  getItemDataProvider: vi.fn(),
  getUpstreamIngestor: vi.fn(),
}));

import { getItemDataProvider, getUpstreamIngestor } from "../../../src/server/runtime";
import { ItemSearchError } from "@pitantir/shared/item-data";
import { IdentityService, MemoryIdentityStore, UpstreamObservationIngestor } from "@pitantir/db";
import { PitPandaItemDataProvider } from "@pitantir/shared/item-data";

describe("POST /api/item-search", () => {
  beforeEach(() => {
    vi.mocked(getUpstreamIngestor).mockReturnValue(
      new UpstreamObservationIngestor(new IdentityService(new MemoryIdentityStore())),
    );
  });

  it("returns invalid_search for malformed JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/item-search", {
        method: "POST",
        body: "not-json",
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.status).toBe("invalid_search");
  });

  it("returns invalid_search for invalid username", async () => {
    vi.mocked(getItemDataProvider).mockReturnValue(
      new PitPandaItemDataProvider({ apiKey: "test-key" }),
    );

    const response = await POST(
      new Request("http://localhost/api/item-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "current_owner", value: "!!!", page: 0 }),
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.status).toBe("invalid_search");
  });

  it("returns configuration_error when provider is not configured", async () => {
    vi.mocked(getItemDataProvider).mockImplementation(() => {
      throw new ItemSearchError(
        "configuration_error",
        "Search is not configured on the server.",
      );
    });

    const response = await POST(
      new Request("http://localhost/api/item-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "exact_nonce", value: "abc-123", page: 0 }),
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(503);
    expect(payload.status).toBe("configuration_error");
    expect(payload.message).not.toMatch(/api[_-]?key/i);
  });

  it("returns ok with pitpanda dataSource for successful search", async () => {
    vi.mocked(getItemDataProvider).mockReturnValue(
      new PitPandaItemDataProvider({
        apiKey: "test-key",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({ success: true, items: [{ title: "Test Book" }] }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/item-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "exact_nonce", value: "abc-123", page: 0 }),
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.status).toBe("ok");
    expect(payload.dataSource).toBe("pitpanda");
    expect(payload.items).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain("test-key");
  });

  it("returns no_results when upstream returns an empty page", async () => {
    vi.mocked(getItemDataProvider).mockReturnValue(
      new PitPandaItemDataProvider({
        apiKey: "test-key",
        fetchImpl: async () =>
          new Response(JSON.stringify({ success: true, items: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/item-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "past_owner", value: "Notch", page: 0 }),
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.status).toBe("no_results");
    expect(payload.dataSource).toBe("pitpanda");
  });
});
