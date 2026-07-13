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
  it("allows two canonical items with the same nonce", () => {
    const { service } = createHarness();
    const itemA = service.createItem({ primaryNonce: "nonce-shared-001", category: "duplicate_nonce" });
    const itemB = service.createItem({ primaryNonce: "nonce-shared-001", category: "duplicate_nonce" });

    service.addIdentifier(itemA.id, "nonce", "nonce-shared-001");
    service.addIdentifier(itemB.id, "nonce", "nonce-shared-001");

    expect(itemA.id).not.toBe(itemB.id);
    expect(service.addIdentifier(itemA.id, "nonce", "nonce-shared-001").itemId).toBe(itemA.id);
    expect(service.addIdentifier(itemB.id, "nonce", "nonce-shared-001").itemId).toBe(itemB.id);
  });

  it("allows one item with multiple external identifiers", () => {
    const { service } = createHarness();
    const item = service.createItem({ displayName: "Collector's Copy" });

    service.addIdentifier(item.id, "external_ref", "128", "bookwiki");
    service.addIdentifier(item.id, "external_ref", "sheet-row-9", "collector_sheet");

    const identifiers = service["store"].listIdentifiersForItem(item.id);
    expect(identifiers).toHaveLength(2);
    expect(identifiers.map((row) => `${row.source}:${row.value}`).sort()).toEqual([
      "bookwiki:128",
      "collector_sheet:sheet-row-9",
    ]);
  });

  it("keeps external IDs namespaced per source even when values collide", () => {
    const { service } = createHarness();
    const itemA = service.createItem();
    const itemB = service.createItem();

    service.addIdentifier(itemA.id, "external_ref", "128", "source_a");
    service.addIdentifier(itemB.id, "external_ref", "128", "source_b");

    expect(() => service.addIdentifier(itemB.id, "external_ref", "128", "source_a")).toThrow(
      /already linked/,
    );
  });

  it("leaves an observation without a nonce unresolved by default", () => {
    const { service, accountId, scanId, observedAt } = createHarness();
    const observation = service.createObservationFromRaw({
      scanId,
      accountId,
      observedAt,
      slotKey: "inv:0",
      rawItem: bookRaw({ nonce: undefined }),
    });

    const result = service.resolveObservationAuto(observation.id);
    expect(result.observation.resolutionStatus).toBe("unresolved");
    expect(result.observation.canonicalItemId).toBeNull();
    expect(result.decision).toBeNull();
  });

  it("marks an observation ambiguous when two candidates share a nonce", () => {
    const { service, accountId, scanId, observedAt } = createHarness();
    const raw = bookRaw();
    const { strictFingerprint } = fingerprintFromRawItem(raw);

    const itemA = service.createItem({
      category: "duplicate_nonce",
      primaryNonce: "nonce-shared-001",
      strictFingerprint,
    });
    const itemB = service.createItem({
      category: "duplicate_nonce",
      primaryNonce: "nonce-shared-001",
      strictFingerprint,
    });
    service.addIdentifier(itemA.id, "nonce", "nonce-shared-001");
    service.addIdentifier(itemB.id, "nonce", "nonce-shared-001");

    const observation = service.createObservationFromRaw({
      scanId,
      accountId,
      observedAt,
      slotKey: "inv:1",
      rawItem: raw,
    });

    const result = service.resolveObservationAuto(observation.id);
    expect(result.observation.resolutionStatus).toBe("ambiguous");
    expect(result.observation.canonicalItemId).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });

  it("merges two items without deleting historical identity", () => {
    const { service, store, accountId, scanId, observedAt } = createHarness();
    const survivor = service.createItem({ displayName: "Survivor" });
    const loser = service.createItem({ displayName: "Loser" });
    service.addIdentifier(loser.id, "external_ref", "77", "bookwiki");

    const observation = service.createObservationFromRaw({
      scanId,
      accountId,
      observedAt,
      slotKey: "inv:2",
      rawItem: bookRaw({ nonce: "loser-nonce" }),
    });
    service.resolveObservationManual({
      observationId: observation.id,
      itemId: loser.id,
      actor: "operator-1",
      rationale: "assign to loser before merge",
    });

    const decision = service.mergeItems({
      survivorItemId: survivor.id,
      loserItemId: loser.id,
      actor: "operator-1",
      rationale: "same physical book",
    });

    const mergedLoser = store.getCanonicalItem(loser.id)!;
    expect(mergedLoser.status).toBe("merged_away");
    expect(mergedLoser.mergedIntoItemId).toBe(survivor.id);
    expect(store.getObservation(observation.id)?.canonicalItemId).toBe(survivor.id);
    expect(store.listIdentifiersForItem(survivor.id).some((row) => row.value === "77")).toBe(true);
    expect(decision.decisionType).toBe("merge");
    expect(decision.actor).toBe("operator-1");
    expect(decision.rationale).toBe("same physical book");
    expect(decision.beforeState).toBeTruthy();
    expect(decision.afterState).toBeTruthy();
  });

  it("splits observations back into separate items", () => {
    const { service, store, accountId, scanId, observedAt } = createHarness();
    const source = service.createItem({ category: "duplicate_nonce", primaryNonce: "nonce-shared-001" });
    service.addIdentifier(source.id, "nonce", "nonce-shared-001");

    const obsA = service.createObservationFromRaw({
      scanId,
      accountId,
      observedAt,
      slotKey: "inv:3",
      rawItem: bookRaw({ nonce: "nonce-shared-001" }),
    });
    const obsB = service.createObservationFromRaw({
      scanId,
      accountId,
      observedAt: new Date("2026-01-02T12:00:00Z"),
      slotKey: "inv:4",
      rawItem: bookRaw({ nonce: "nonce-shared-001" }),
    });

    service.resolveObservationManual({
      observationId: obsA.id,
      itemId: source.id,
      actor: "operator-1",
      rationale: "temporarily same item",
    });
    service.resolveObservationManual({
      observationId: obsB.id,
      itemId: source.id,
      actor: "operator-1",
      rationale: "temporarily same item",
    });

    const splitDecision = service.splitItem({
      sourceItemId: source.id,
      actor: "operator-1",
      rationale: "discovered duplicate copies",
      assignments: [
        { createNewItem: true, observationIds: [obsA.id], displayName: "Copy A" },
        { createNewItem: true, observationIds: [obsB.id], displayName: "Copy B" },
      ],
    });

    const splitItems = splitDecision.toItemIds.map((itemId) => store.getCanonicalItem(itemId)!);
    expect(splitItems).toHaveLength(2);
    expect(store.getObservation(obsA.id)?.canonicalItemId).toBe(splitItems[0]!.id);
    expect(store.getObservation(obsB.id)?.canonicalItemId).toBe(splitItems[1]!.id);
    expect(store.getCanonicalItem(source.id)?.status).toBe("split_source");
    for (const item of splitItems) {
      expect(store.listIdentifiersForItem(item.id).some((row) => row.kind === "nonce")).toBe(true);
    }
  });

  it("is idempotent when rerunning the same auto resolution", () => {
    const { service, accountId, scanId, observedAt } = createHarness();
    const observation = service.createObservationFromRaw({
      scanId,
      accountId,
      observedAt,
      slotKey: "inv:5",
      rawItem: bookRaw({ nonce: "brand-new-nonce" }),
    });

    const first = service.resolveObservationAuto(observation.id);
    const second = service.resolveObservationAuto(observation.id);

    expect(second.decision?.id).toBe(first.decision?.id);
    expect(second.observation.canonicalItemId).toBe(first.observation.canonicalItemId);
    expect(second.candidates).toHaveLength(first.candidates.length);
  });

  it("reverses a manual decision and restores previous state", () => {
    const { service, store, accountId, scanId, observedAt } = createHarness();
    const item = service.createItem();
    const observation = service.createObservationFromRaw({
      scanId,
      accountId,
      observedAt,
      slotKey: "inv:6",
      rawItem: bookRaw({ nonce: "manual-nonce" }),
    });

    const manual = service.resolveObservationManual({
      observationId: observation.id,
      itemId: item.id,
      actor: "operator-1",
      rationale: "manual link",
    });

    const revert = service.revertDecision({
      decisionId: manual.decision!.id,
      actor: "operator-2",
      rationale: "undo incorrect manual link",
    });

    const restored = store.getObservation(observation.id)!;
    expect(restored.resolutionStatus).toBe("unresolved");
    expect(restored.canonicalItemId).toBeNull();
    expect(revert.decisionType).toBe("revert");
    expect(revert.actor).toBe("operator-2");
    expect(revert.rationale).toBe("undo incorrect manual link");
    expect(store.getDecision(manual.decision!.id)?.reversedByDecisionId).toBe(revert.id);
  });

  it("preserves raw observation payload when identity changes", () => {
    const { service, store, accountId, scanId, observedAt } = createHarness();
    const raw = bookRaw({ nonce: "immutable-nonce", title: "Immutable Title" });
    const observation = service.createObservationFromRaw({
      scanId,
      accountId,
      observedAt,
      slotKey: "inv:7",
      rawItem: raw,
    });
    const originalRaw = structuredClone(observation.rawItem);

    const item = service.createItem();
    service.resolveObservationManual({
      observationId: observation.id,
      itemId: item.id,
      actor: "operator-1",
      rationale: "assign",
    });

    expect(store.getObservation(observation.id)?.rawItem).toEqual(originalRaw);
  });
});
