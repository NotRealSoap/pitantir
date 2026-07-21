import { describe, expect, it } from "vitest";
import { fingerprintFromRawItem } from "@pitantir/shared/identity";
import { IdentityService } from "./service.js";
import { MemoryIdentityStore } from "./memory-store.js";
import { randomUUID } from "node:crypto";

function createHarness() {
  const store = new MemoryIdentityStore();
  const service = new IdentityService(store);
  const accountId = randomUUID();
  const scanId = randomUUID();
  const observedAt = new Date("2026-01-01T12:00:00Z");

  return { store, service, accountId, scanId, observedAt };
}

function bookRaw(overrides: Record<string, unknown> = {}) {
  return {
    title: "Ancient Tome",
    author: "Archivist",
    pageCount: 3,
    pages: "line one\nline two",
    generation: "gen-1",
    nonce: "nonce-shared-001",
    ...overrides,
  };
}

describe("item identity resolution", () => {
  it("allows two canonical items with the same nonce", async () => {
    const { service } = createHarness();
    const itemA = await service.createItem({ primaryNonce: "nonce-shared-001", category: "duplicate_nonce" });
    const itemB = await service.createItem({ primaryNonce: "nonce-shared-001", category: "duplicate_nonce" });

    await service.addIdentifier(itemA.id, "nonce", "nonce-shared-001");
    await service.addIdentifier(itemB.id, "nonce", "nonce-shared-001");

    expect(itemA.id).not.toBe(itemB.id);
    expect((await service.addIdentifier(itemA.id, "nonce", "nonce-shared-001")).itemId).toBe(itemA.id);
    expect((await service.addIdentifier(itemB.id, "nonce", "nonce-shared-001")).itemId).toBe(itemB.id);
  });

  it("allows one item with multiple external identifiers", async () => {
    const { service } = createHarness();
    const item = await service.createItem({ displayName: "Collector's Copy" });

    await service.addIdentifier(item.id, "external_ref", "128", "bookwiki");
    await service.addIdentifier(item.id, "external_ref", "sheet-row-9", "collector_sheet");

    const identifiers = await service["store"].listIdentifiersForItem(item.id);
    expect(identifiers).toHaveLength(2);
    expect(identifiers.map((row) => `${row.source}:${row.value}`).sort()).toEqual([
      "bookwiki:128",
      "collector_sheet:sheet-row-9",
    ]);
  });

  it("keeps external IDs namespaced per source even when values collide", async () => {
    const { service } = createHarness();
    const itemA = await service.createItem();
    const itemB = await service.createItem();

    await service.addIdentifier(itemA.id, "external_ref", "128", "source_a");
    await service.addIdentifier(itemB.id, "external_ref", "128", "source_b");

    await expect(service.addIdentifier(itemB.id, "external_ref", "128", "source_a")).rejects.toThrow(
      /already linked/,
    );
  });

  it("leaves an observation without a nonce unresolved by default", async () => {
    const { service, accountId, scanId, observedAt } = createHarness();
    const observation = await service.createObservationFromRaw({
      scanId,
      accountId,
      observedAt,
      slotKey: "inv:0",
      rawItem: bookRaw({ nonce: undefined }),
    });

    const result = await service.resolveObservationAuto(observation.id);
    expect(result.observation.resolutionStatus).toBe("unresolved");
    expect(result.observation.canonicalItemId).toBeNull();
    expect(result.decision).toBeNull();
  });

  it("marks an observation ambiguous when two candidates share a nonce", async () => {
    const { service, accountId, scanId, observedAt } = createHarness();
    const raw = bookRaw();
    const { strictFingerprint } = fingerprintFromRawItem(raw);

    const itemA = await service.createItem({
      category: "duplicate_nonce",
      primaryNonce: "nonce-shared-001",
      strictFingerprint,
    });
    const itemB = await service.createItem({
      category: "duplicate_nonce",
      primaryNonce: "nonce-shared-001",
      strictFingerprint,
    });
    await service.addIdentifier(itemA.id, "nonce", "nonce-shared-001");
    await service.addIdentifier(itemB.id, "nonce", "nonce-shared-001");

    const observation = await service.createObservationFromRaw({
      scanId,
      accountId,
      observedAt,
      slotKey: "inv:1",
      rawItem: raw,
    });

    const result = await service.resolveObservationAuto(observation.id);
    expect(result.observation.resolutionStatus).toBe("ambiguous");
    expect(result.observation.canonicalItemId).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });

  it("merges two items without deleting historical identity", async () => {
    const { service, store, accountId, scanId, observedAt } = createHarness();
    const survivor = await service.createItem({ displayName: "Survivor" });
    const loser = await service.createItem({ displayName: "Loser" });
    await service.addIdentifier(loser.id, "external_ref", "77", "bookwiki");

    const observation = await service.createObservationFromRaw({
      scanId,
      accountId,
      observedAt,
      slotKey: "inv:2",
      rawItem: bookRaw({ nonce: "loser-nonce" }),
    });
    await service.resolveObservationManual({
      observationId: observation.id,
      itemId: loser.id,
      actor: "operator-1",
      rationale: "assign to loser before merge",
    });

    const decision = await service.mergeItems({
      survivorItemId: survivor.id,
      loserItemId: loser.id,
      actor: "operator-1",
      rationale: "same physical book",
    });

    const mergedLoser = (await store.getCanonicalItem(loser.id))!;
    expect(mergedLoser.status).toBe("merged_away");
    expect(mergedLoser.mergedIntoItemId).toBe(survivor.id);
    expect((await store.getObservation(observation.id))?.canonicalItemId).toBe(survivor.id);
    expect((await store.listIdentifiersForItem(survivor.id)).some((row) => row.value === "77")).toBe(true);
    expect(decision.decisionType).toBe("merge");
    expect(decision.actor).toBe("operator-1");
    expect(decision.rationale).toBe("same physical book");
    expect(decision.beforeState).toBeTruthy();
    expect(decision.afterState).toBeTruthy();
  });

  it("splits observations back into separate items", async () => {
    const { service, store, accountId, scanId, observedAt } = createHarness();
    const source = await service.createItem({ category: "duplicate_nonce", primaryNonce: "nonce-shared-001" });
    await service.addIdentifier(source.id, "nonce", "nonce-shared-001");

    const obsA = await service.createObservationFromRaw({
      scanId,
      accountId,
      observedAt,
      slotKey: "inv:3",
      rawItem: bookRaw({ nonce: "nonce-shared-001" }),
    });
    const obsB = await service.createObservationFromRaw({
      scanId,
      accountId,
      observedAt: new Date("2026-01-02T12:00:00Z"),
      slotKey: "inv:4",
      rawItem: bookRaw({ nonce: "nonce-shared-001" }),
    });

    await service.resolveObservationManual({
      observationId: obsA.id,
      itemId: source.id,
      actor: "operator-1",
      rationale: "temporarily same item",
    });
    await service.resolveObservationManual({
      observationId: obsB.id,
      itemId: source.id,
      actor: "operator-1",
      rationale: "temporarily same item",
    });

    const splitDecision = await service.splitItem({
      sourceItemId: source.id,
      actor: "operator-1",
      rationale: "discovered duplicate copies",
      assignments: [
        { createNewItem: true, observationIds: [obsA.id], displayName: "Copy A" },
        { createNewItem: true, observationIds: [obsB.id], displayName: "Copy B" },
      ],
    });

    const splitItems = await Promise.all(
      splitDecision.toItemIds.map((itemId) => store.getCanonicalItem(itemId)),
    );
    expect(splitItems).toHaveLength(2);
    expect((await store.getObservation(obsA.id))?.canonicalItemId).toBe(splitItems[0]!.id);
    expect((await store.getObservation(obsB.id))?.canonicalItemId).toBe(splitItems[1]!.id);
    expect((await store.getCanonicalItem(source.id))?.status).toBe("split_source");
    for (const item of splitItems) {
      expect((await store.listIdentifiersForItem(item!.id)).some((row) => row.kind === "nonce")).toBe(true);
    }
  });

  it("is idempotent when rerunning the same auto resolution", async () => {
    const { service, accountId, scanId, observedAt } = createHarness();
    const observation = await service.createObservationFromRaw({
      scanId,
      accountId,
      observedAt,
      slotKey: "inv:5",
      rawItem: bookRaw({ nonce: "brand-new-nonce" }),
    });

    const first = await service.resolveObservationAuto(observation.id);
    const second = await service.resolveObservationAuto(observation.id);

    expect(second.decision?.id).toBe(first.decision?.id);
    expect(second.observation.canonicalItemId).toBe(first.observation.canonicalItemId);
    expect(second.candidates).toHaveLength(first.candidates.length);
  });

  it("reverses a manual decision and restores previous state", async () => {
    const { service, store, accountId, scanId, observedAt } = createHarness();
    const item = await service.createItem();
    const observation = await service.createObservationFromRaw({
      scanId,
      accountId,
      observedAt,
      slotKey: "inv:6",
      rawItem: bookRaw({ nonce: "manual-nonce" }),
    });

    const manual = await service.resolveObservationManual({
      observationId: observation.id,
      itemId: item.id,
      actor: "operator-1",
      rationale: "manual link",
    });

    const revert = await service.revertDecision({
      decisionId: manual.decision!.id,
      actor: "operator-2",
      rationale: "undo incorrect manual link",
    });

    const restored = (await store.getObservation(observation.id))!;
    expect(restored.resolutionStatus).toBe("unresolved");
    expect(restored.canonicalItemId).toBeNull();
    expect(revert.decisionType).toBe("revert");
    expect(revert.actor).toBe("operator-2");
    expect(revert.rationale).toBe("undo incorrect manual link");
    expect((await store.getDecision(manual.decision!.id))?.reversedByDecisionId).toBe(revert.id);
  });

  it("preserves raw observation payload when identity changes", async () => {
    const { service, store, accountId, scanId, observedAt } = createHarness();
    const raw = bookRaw({ nonce: "immutable-nonce", title: "Immutable Title" });
    const observation = await service.createObservationFromRaw({
      scanId,
      accountId,
      observedAt,
      slotKey: "inv:7",
      rawItem: raw,
    });
    const originalRaw = structuredClone(observation.rawItem);

    const item = await service.createItem();
    await service.resolveObservationManual({
      observationId: observation.id,
      itemId: item.id,
      actor: "operator-1",
      rationale: "assign",
    });

    expect((await store.getObservation(observation.id))?.rawItem).toEqual(originalRaw);
  });
});
