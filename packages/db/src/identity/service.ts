import {
  autoResolveObservation,
  fingerprintFromRawItem,
  type AutoResolveSettings,
  type CanonicalItem,
  type IdentityDecision,
  type ItemIdentifier,
  type Observation,
  type ResolveObservationResult,
} from "@pitantir/shared/identity";
import {
  mergeItemsInputSchema,
  manualResolveInputSchema,
  revertDecisionInputSchema,
  splitItemInputSchema,
} from "@pitantir/shared/identity";
import { captureSnapshot, decisionState, isDecisionReversible, restoreSnapshot } from "./snapshots.js";
import type { IdentitySnapshot } from "./snapshots.js";
import type { CreateObservationInput, IdentityStore } from "./store.js";
import { now } from "./store.js";

export class IdentityService {
  constructor(private readonly store: IdentityStore) {}

  createItem(input?: {
    displayName?: string | null;
    category?: CanonicalItem["category"];
    primaryNonce?: string | null;
    strictFingerprint?: string | null;
    looseFingerprint?: string | null;
  }): CanonicalItem {
    return this.store.createCanonicalItem(input);
  }

  addIdentifier(
    itemId: string,
    kind: ItemIdentifier["kind"],
    value: string,
    source: string | null = null,
  ): ItemIdentifier {
    return this.store.addIdentifier({ itemId, kind, value, source });
  }

  createObservation(input: CreateObservationInput): Observation {
    return this.store.createObservation(input);
  }

  createObservationFromRaw(input: {
    scanId: string;
    accountId: string;
    observedAt: Date;
    slotKey: string;
    rawItem: Record<string, unknown>;
  }): Observation {
    const derived = fingerprintFromRawItem(input.rawItem);
    return this.createObservation({
      ...input,
      observedNonce: derived.nonce,
      normalizedMetadata: derived.metadata,
      strictFingerprint: derived.strictFingerprint,
      looseFingerprint: derived.looseFingerprint,
    });
  }

  private identifiersByItemId(): Map<string, ItemIdentifier[]> {
    const map = new Map<string, ItemIdentifier[]>();
    for (const item of this.store.listActiveCanonicalItems()) {
      map.set(item.id, this.store.listIdentifiersForItem(item.id));
    }
    return map;
  }

  resolveObservationAuto(
    observationId: string,
    options?: { reopen?: boolean; settings?: AutoResolveSettings },
  ): ResolveObservationResult {
    const observation = this.store.getObservation(observationId);
    if (!observation) {
      throw new Error(`Observation not found: ${observationId}`);
    }

    if (observation.resolutionStatus === "manually_resolved" && !options?.reopen) {
      return {
        observation,
        decision: null,
        candidates: this.store.listCandidates(observationId),
        createdItem: null,
      };
    }

    const idempotencyKey = `auto_resolve:${observationId}`;
    const existingDecision = this.store.findDecisionByIdempotencyKey(idempotencyKey);
    if (existingDecision && !options?.reopen) {
      return {
        observation: this.store.getObservation(observationId)!,
        decision: existingDecision,
        candidates: this.store.listCandidates(observationId),
        createdItem: existingDecision.toItemIds[0]
          ? this.store.getCanonicalItem(existingDecision.toItemIds[0])
          : null,
      };
    }

    const before = captureSnapshot(this.store, [], [observationId]);
    const settings = options?.settings ?? this.store.getSettings();
    const openPresence = this.store
      .listOpenPresenceOnAccount(observation.accountId)
      .map((period) => period.itemId);

    const outcome = autoResolveObservation({
      observation,
      activeItems: this.store.listActiveCanonicalItems(),
      identifiersByItemId: this.identifiersByItemId(),
      openPresenceOnAccountItemIds: new Set(openPresence),
      settings,
    });

    const candidates = this.store.upsertObservationCandidates(
      observationId,
      outcome.candidates.map((candidate) => ({
        itemId: candidate.itemId,
        score: candidate.score,
        reasons: candidate.reasons,
      })),
    );

    let createdItem: CanonicalItem | null = null;
    let targetItemId = outcome.canonicalItemId;

    if (outcome.shouldCreateItem) {
      createdItem = this.store.createCanonicalItem({
        category: outcome.createdItemCategory,
        primaryNonce: observation.observedNonce,
        strictFingerprint: observation.strictFingerprint,
        looseFingerprint: observation.looseFingerprint,
        identityConfidence: "medium",
      });
      targetItemId = createdItem.id;

      if (observation.observedNonce) {
        this.store.addIdentifier({
          itemId: createdItem.id,
          kind: "nonce",
          value: observation.observedNonce,
        });
      }
      this.store.addIdentifier({
        itemId: createdItem.id,
        kind: "strict_fingerprint",
        value: observation.strictFingerprint,
      });
      this.store.addIdentifier({
        itemId: createdItem.id,
        kind: "loose_fingerprint",
        value: observation.looseFingerprint,
      });
    }

    const updatedObservation = this.store.updateObservationResolution(observationId, {
      canonicalItemId: targetItemId,
      resolutionStatus: outcome.status,
      confidence: outcome.confidence,
      resolutionNote: null,
      resolvedAt: targetItemId || outcome.status !== "unresolved" ? now() : null,
      resolvedBy: targetItemId || outcome.status !== "unresolved" ? "auto" : null,
    });

    if (targetItemId && (outcome.status === "resolved" || outcome.status === "manually_resolved")) {
      this.ensurePresencePeriod(targetItemId, observation);
    }

    const after = captureSnapshot(
      this.store,
      targetItemId ? [targetItemId] : [],
      [observationId],
    );

    const decision =
      outcome.status === "unresolved" && !outcome.shouldCreateItem
        ? null
        : this.store.appendDecision({
            decisionType: outcome.shouldCreateItem ? "create_item" : "auto_resolve",
            actor: "system",
            observationId,
            importClaimId: null,
            fromItemIds: [],
            toItemIds: targetItemId ? [targetItemId] : [],
            beforeState: decisionState(before),
            afterState: decisionState(after),
            rationale: outcome.shouldCreateItem
              ? "Auto-created canonical item for novel nonce"
              : `Auto resolution status: ${outcome.status}`,
            idempotencyKey,
            revertsDecisionId: null,
          });

    return {
      observation: updatedObservation,
      decision,
      candidates,
      createdItem,
    };
  }

  resolveObservationManual(input: {
    observationId: string;
    itemId?: string;
    createNewItem?: boolean;
    actor: string;
    rationale: string;
    idempotencyKey?: string;
  }): ResolveObservationResult {
    const parsed = manualResolveInputSchema.parse(input);
    const observation = this.store.getObservation(parsed.observationId);
    if (!observation) {
      throw new Error(`Observation not found: ${parsed.observationId}`);
    }

    const idempotencyKey =
      parsed.idempotencyKey ?? `manual_resolve:${parsed.observationId}:${parsed.itemId ?? "new"}`;
    const existing = this.store.findDecisionByIdempotencyKey(idempotencyKey);
    if (existing) {
      return {
        observation: this.store.getObservation(parsed.observationId)!,
        decision: existing,
        candidates: this.store.listCandidates(parsed.observationId),
        createdItem: existing.toItemIds[0]
          ? this.store.getCanonicalItem(existing.toItemIds[0])
          : null,
      };
    }

    const before = captureSnapshot(this.store, [], [parsed.observationId]);
    let targetItem: CanonicalItem | null = null;

    if (parsed.createNewItem || !parsed.itemId) {
      targetItem = this.store.createCanonicalItem({
        category: observation.observedNonce ? "unique_nonce_candidate" : "nonce_less",
        primaryNonce: observation.observedNonce,
        strictFingerprint: observation.strictFingerprint,
        looseFingerprint: observation.looseFingerprint,
      });
      if (observation.observedNonce) {
        this.store.addIdentifier({
          itemId: targetItem.id,
          kind: "nonce",
          value: observation.observedNonce,
        });
      }
    } else {
      targetItem = this.store.getCanonicalItem(parsed.itemId);
      if (!targetItem) {
        throw new Error(`Canonical item not found: ${parsed.itemId}`);
      }
    }

    const updatedObservation = this.store.updateObservationResolution(parsed.observationId, {
      canonicalItemId: targetItem.id,
      resolutionStatus: "manually_resolved",
      confidence: 1,
      resolutionNote: parsed.rationale,
      resolvedAt: now(),
      resolvedBy: "manual",
    });

    this.ensurePresencePeriod(targetItem.id, observation);

    const after = captureSnapshot(this.store, [targetItem.id], [parsed.observationId]);
    const decision = this.store.appendDecision({
      decisionType: "manual_resolve",
      actor: parsed.actor,
      observationId: parsed.observationId,
      importClaimId: null,
      fromItemIds: [],
      toItemIds: [targetItem.id],
      beforeState: decisionState(before),
      afterState: decisionState(after),
      rationale: parsed.rationale,
      idempotencyKey,
      revertsDecisionId: null,
    });

    return {
      observation: updatedObservation,
      decision,
      candidates: this.store.listCandidates(parsed.observationId),
      createdItem: parsed.createNewItem ? targetItem : null,
    };
  }

  mergeItems(input: {
    survivorItemId: string;
    loserItemId: string;
    actor: string;
    rationale: string;
    idempotencyKey?: string;
  }): IdentityDecision {
    const parsed = mergeItemsInputSchema.parse(input);
    if (parsed.survivorItemId === parsed.loserItemId) {
      throw new Error("Cannot merge an item with itself");
    }

    const idempotencyKey =
      parsed.idempotencyKey ?? `merge:${parsed.survivorItemId}:${parsed.loserItemId}`;
    const existing = this.store.findDecisionByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    const survivor = this.store.getCanonicalItem(parsed.survivorItemId);
    const loser = this.store.getCanonicalItem(parsed.loserItemId);
    if (!survivor || !loser) {
      throw new Error("Both survivor and loser items must exist");
    }
    if (loser.status === "merged_away") {
      throw new Error("Loser item is already merged away");
    }

    const before = captureSnapshot(this.store, [survivor.id, loser.id]);

    for (const identifier of this.store.listIdentifiersForItem(loser.id)) {
      const duplicate = this.store
        .listIdentifiersForItem(survivor.id)
        .find(
          (row) =>
            row.kind === identifier.kind &&
            row.source === identifier.source &&
            row.value === identifier.value,
        );

      this.store.invalidateIdentifier(identifier.id);

      if (!duplicate) {
        this.store.addIdentifier({
          itemId: survivor.id,
          kind: identifier.kind,
          value: identifier.value,
          source: identifier.source,
          confidence: identifier.confidence,
        });
      }
    }

    for (const observation of this.store.listObservationsForItem(loser.id)) {
      this.store.updateObservationResolution(observation.id, {
        canonicalItemId: survivor.id,
        resolutionStatus: observation.resolutionStatus,
        confidence: observation.confidence,
        resolutionNote: observation.resolutionNote,
        resolvedAt: observation.resolvedAt,
        resolvedBy: observation.resolvedBy,
      });
    }

    const survivorPeriods = this.store.listLocationPeriodsForItem(survivor.id);
    const loserPeriods = this.store.listLocationPeriodsForItem(loser.id);
    for (const loserPeriod of loserPeriods) {
      const contradiction = survivorPeriods.some(
        (survivorPeriod) =>
          survivorPeriod.accountId &&
          loserPeriod.accountId &&
          survivorPeriod.accountId !== loserPeriod.accountId &&
          survivorPeriod.endedAt === null &&
          loserPeriod.endedAt === null,
      );

      this.store.createLocationPeriod({
        itemId: survivor.id,
        accountId: loserPeriod.accountId,
        startedAt: loserPeriod.startedAt,
        endedAt: loserPeriod.endedAt,
        startReason: "merge",
        endReason: loserPeriod.endReason,
        certainty: contradiction ? "contradicted" : loserPeriod.certainty,
        isUnknownGap: loserPeriod.isUnknownGap,
        openingObservationId: loserPeriod.openingObservationId,
        closingObservationContextScanId: loserPeriod.closingObservationContextScanId,
        notes: loserPeriod.notes,
      });
    }

    this.store.updateCanonicalItem(loser.id, {
      status: "merged_away",
      mergedIntoItemId: survivor.id,
    });

    const after = captureSnapshot(this.store, [survivor.id, loser.id]);
    return this.store.appendDecision({
      decisionType: "merge",
      actor: parsed.actor,
      observationId: null,
      importClaimId: null,
      fromItemIds: [loser.id],
      toItemIds: [survivor.id],
      beforeState: decisionState(before),
      afterState: decisionState(after),
      rationale: parsed.rationale,
      idempotencyKey,
      revertsDecisionId: null,
    });
  }

  splitItem(input: {
    sourceItemId: string;
    actor: string;
    rationale: string;
    assignments: Array<{
      targetItemId?: string;
      createNewItem?: boolean;
      observationIds: string[];
      displayName?: string;
    }>;
    idempotencyKey?: string;
  }): IdentityDecision {
    const parsed = splitItemInputSchema.parse(input);
    const sourceItem = this.store.getCanonicalItem(parsed.sourceItemId);
    if (!sourceItem) {
      throw new Error(`Source item not found: ${parsed.sourceItemId}`);
    }

    const idempotencyKey = parsed.idempotencyKey ?? `split:${parsed.sourceItemId}:${parsed.assignments.length}`;
    const existing = this.store.findDecisionByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    const before = captureSnapshot(this.store, [sourceItem.id]);
    const targetItems: CanonicalItem[] = [];

    for (const assignment of parsed.assignments) {
      let targetItem: CanonicalItem;
      if (assignment.createNewItem || !assignment.targetItemId) {
        targetItem = this.store.createCanonicalItem({
          displayName: assignment.displayName ?? null,
          category: sourceItem.category,
          primaryNonce: sourceItem.primaryNonce,
          strictFingerprint: sourceItem.strictFingerprint,
          looseFingerprint: sourceItem.looseFingerprint,
        });
      } else {
        const existingItem = this.store.getCanonicalItem(assignment.targetItemId);
        if (!existingItem) {
          throw new Error(`Target item not found: ${assignment.targetItemId}`);
        }
        targetItem = existingItem;
      }

      for (const nonceIdentifier of this.store
        .listIdentifiersForItem(sourceItem.id)
        .filter((identifier) => identifier.kind === "nonce")) {
        this.store.addIdentifier({
          itemId: targetItem.id,
          kind: "nonce",
          value: nonceIdentifier.value,
        });
      }

      for (const observationId of assignment.observationIds) {
        const observation = this.store.getObservation(observationId);
        if (!observation) {
          throw new Error(`Observation not found: ${observationId}`);
        }
        this.store.updateObservationResolution(observationId, {
          canonicalItemId: targetItem.id,
          resolutionStatus: "manually_resolved",
          confidence: 1,
          resolutionNote: parsed.rationale,
          resolvedAt: now(),
          resolvedBy: "manual",
        });
        this.ensurePresencePeriod(targetItem.id, observation);
      }

      targetItems.push(targetItem);
    }

    this.store.supersedeLocationPeriodsForItem(sourceItem.id, now());
    this.store.updateCanonicalItem(sourceItem.id, {
      status: "split_source",
    });

    const after = captureSnapshot(
      this.store,
      [sourceItem.id, ...targetItems.map((item) => item.id)],
      parsed.assignments.flatMap((assignment) => assignment.observationIds),
    );

    return this.store.appendDecision({
      decisionType: "split",
      actor: parsed.actor,
      observationId: null,
      importClaimId: null,
      fromItemIds: [sourceItem.id],
      toItemIds: targetItems.map((item) => item.id),
      beforeState: decisionState(before),
      afterState: decisionState(after),
      rationale: parsed.rationale,
      idempotencyKey,
      revertsDecisionId: null,
    });
  }

  revertDecision(input: {
    decisionId: string;
    actor: string;
    rationale: string;
    idempotencyKey?: string;
  }): IdentityDecision {
    const parsed = revertDecisionInputSchema.parse(input);
    const original = this.store.getDecision(parsed.decisionId);
    if (!original) {
      throw new Error(`Decision not found: ${parsed.decisionId}`);
    }
    if (!isDecisionReversible(original)) {
      throw new Error(`Decision ${parsed.decisionId} is not reversible`);
    }

    const idempotencyKey = parsed.idempotencyKey ?? `revert:${parsed.decisionId}`;
    const existing = this.store.findDecisionByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    const before = structuredClone(original.afterState);
    restoreSnapshot(this.store, original.beforeState as unknown as IdentitySnapshot);

    const revertDecision = this.store.appendDecision({
      decisionType: "revert",
      actor: parsed.actor,
      observationId: original.observationId,
      importClaimId: original.importClaimId,
      fromItemIds: [...original.toItemIds],
      toItemIds: [...original.fromItemIds],
      beforeState: before,
      afterState: structuredClone(original.beforeState),
      rationale: parsed.rationale,
      idempotencyKey,
      revertsDecisionId: original.id,
    });

    this.store.markDecisionReversed(original.id, revertDecision.id);
    return revertDecision;
  }

  private ensurePresencePeriod(itemId: string, observation: Observation): void {
    const openOnAccount = this.store
      .listLocationPeriodsForItem(itemId)
      .find(
        (period) =>
          period.accountId === observation.accountId &&
          period.endedAt === null &&
          !period.isUnknownGap,
      );

    if (openOnAccount) {
      return;
    }

    this.store.createLocationPeriod({
      itemId,
      accountId: observation.accountId,
      startedAt: observation.observedAt,
      endedAt: null,
      startReason: "observed",
      endReason: null,
      certainty: "confirmed",
      isUnknownGap: false,
      openingObservationId: observation.id,
      closingObservationContextScanId: null,
      notes: null,
    });
  }
}
