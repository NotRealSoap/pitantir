import { describe, expect, it } from "vitest";
import { PitPandaItemDataProvider } from "@pitantir/shared/item-data";
import {
  IdentityService,
  MemoryIdentityStore,
  UpstreamObservationIngestor,
} from "@pitantir/db";
import { executeItemSearch } from "./item-search-service";

describe("executeItemSearch", () => {
  it("returns no-results without calling upstream when provider returns an empty page", async () => {
    const provider = new PitPandaItemDataProvider({
      apiKey: "test-key",
      fetchImpl: async () =>
        new Response(JSON.stringify({ success: true, items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const result = await executeItemSearch(
      {
        provider,
        ingestor: new UpstreamObservationIngestor(new IdentityService(new MemoryIdentityStore())),
      },
      { kind: "exact_nonce", value: "abc-123", page: 0 },
    );

    expect(result.status).toBe("no_results");
    expect(result.items).toHaveLength(0);
  });

  it("ingests upstream items into identity resolution without forcing a merge", async () => {
    const provider = new PitPandaItemDataProvider({
      apiKey: "test-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            success: true,
            items: [{ nonce: "shared-nonce", title: "Book A" }, { nonce: "shared-nonce", title: "Book B" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    const identity = new IdentityService(new MemoryIdentityStore());
    const result = await executeItemSearch(
      { provider, ingestor: new UpstreamObservationIngestor(identity) },
      { kind: "exact_nonce", value: "shared-nonce", page: 0 },
    );

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(2);
    const statuses = result.items.map((item) => item.resolutionStatus);
    expect(statuses.every((status) => status !== "manually_resolved")).toBe(true);
  });

  it("maps invalid search values to invalid_search", async () => {
    const provider = new PitPandaItemDataProvider({ apiKey: "test-key" });
    const result = await executeItemSearch(
      {
        provider,
        ingestor: new UpstreamObservationIngestor(new IdentityService(new MemoryIdentityStore())),
      },
      { kind: "current_owner", value: "!!!", page: 0 },
    );
    expect(result.status).toBe("invalid_search");
  });
});
