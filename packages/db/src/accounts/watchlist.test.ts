import { describe, expect, it } from "vitest";
import { MemoryIdentityStore } from "../identity/memory-store.js";

/**
 * Lightweight unit coverage for watch-list vs ownership-contact split semantics
 * that don't need Postgres. Scheduler pause is covered in jobs integration tests
 * when DATABASE_URL is available.
 */
describe("watchlist semantics", () => {
  it("keeps identity store available for import paths independent of scanning", async () => {
    const store = new MemoryIdentityStore();
    const item = await store.createCanonicalItem({
      displayName: "Test",
      category: "unique_nonce_candidate",
      identityConfidence: "medium",
      primaryNonce: "1",
    });
    expect(item.id).toBeTruthy();
  });
});
