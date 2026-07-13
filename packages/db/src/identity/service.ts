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

  async createItem(input?: {
    displayName?: string | null;
    category?: CanonicalItem["category"];
    primaryNonce?: string | null;
    strictFingerprint?: string | null;
    looseFingerprint?: string | null;
  }): Promise<CanonicalItem> {
    return this.store.createCanonicalItem(input);
  }

  async addIdentifier(
    itemId: string,
    kind: ItemIdentifier["kind"],
    value: string,
    source: string | null = null,
  ): Promise<ItemIdentifier> {
    return this.store.addIdentifier({ itemId, kind, value, source });
  }

  async createObservation(input: CreateObservationInput): Promise<Observation> {
    return this.store.createObservation(input);
  }

  async createObservationFromRaw(input: {
    scanId: string;
    accountId: string;
    observedAt: Date;
    slotKey: string;
    rawItem: Record<string, unknown>;
  }): Promise<Observation> {
    const derived = fingerprintFromRawItem(input.rawItem);
    return this.createObservation({
      ...input,
      observedNonce: derived.nonce,
      normalizedMetadata: derived.metadata,
      strictFingerprint: derived.strictFingerprint,
      looseFingerprint: derived.looseFingerprint,
    });
  }

  async listObservationsForScan(scanId: string): Promise<Observation[]> {
    return this.store.listObservationsForScan(scanId);
  }

  private async identifiersByItemId(): Promise<Map<string, ItemIdentifier[]>> {
    const map = new Map<string, ItemIdentifier[]>();
    const activeItems = await this.store.listActiveCanonicalItems();
    for (const item of activeItems) {
      map.set(item.id, await this.store.listIdentifiersForItem(item.id));
    }
    return map;
  }

  async resolveObservationAuto(
    observationId: string,
    options?: { reopen?: boolean; settings?: AutoResolveSettings },
  ): Promise<ResolveObservationResult> {
    const observation = await this.store.getObservation(observationId);
    if (!observation) {
      throw new Error(`Observation not found: ${observationId}`);
    }

    if (observation.resolutionStatus === "manually_resolved" && !options?.reopen) {
      return {
        observation,
        decision: null,
        candidates: await this.store.listCandidates(observationId),
        createdItem: null,
      };
    }

    const idempotencyKey = `auto_resolve:${observationId}`;
    const existingDecision = await this.store.findDecisionByIdempotencyKey(idempotencyKey);
    if (existingDecision && !options?.reopen) {
      return {
        observation: (await this.store.getObservation(observationId))!,
        decision: existingDecision,
        candidates: await this.store.listCandidates(observationId),
        createdItem: existingDecision.toItemIds[0]
          ? await this.store.getCanonicalItem(existingDecision.toItemIds[0])
          : null,
      };
    }

    const before = await captureSnapshot(this.store, [], [observationId]);
    const settings = options?.settings ?? (await this.store.getSettings());
    const openPresence = (
      await this.store.listOpenPresenceOnAccount(observation.accountId)
    ).map((period) => period.itemId);

    const outcome = autoResolveObservation({
      observation,
      activeItems: await this.store.listActiveCanonicalItems(),
      identifiersByItemId: await this.identifiersByItemId(),
      openPresenceOnAccountItemIds: new Set(openPresence),
      settings,
    });

    const candidates = await this.store.upsertObservationCandidates(
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
      const title = observation.normalizedMetadata.title ?? null;
      createdItem = await this.store.createCanonicalItem({
        displayName: title,
        category: outcome.createdItemCategory,
        primaryNonce: observation.observedNonce,
        strictFingerprint: observation.strictFingerprint,
        looseFingerprint: observation.looseFingerprint,
        identityConfidence: "medium",
      });
      targetItemId = createdItem.id;

      if (observation.observedNonce) {
        await this.store.addIdentifier({
          itemId: createdItem.id,
          kind: "nonce",
          value: observation.observedNonce,
        });
      }
      await this.store.addIdentifier({
        itemId: createdItem.id,
        kind: "strict_fingerprint",
        value: observation.strictFingerprint,
      });
      await this.store.addIdentifier({
        itemId: createdItem.id,
        kind: "loose_fingerprint",
        value: observation.looseFingerprint,
      });
    }

    const updatedObservation = await this.store.updateObservationResolution(observationId, {
      canonicalItemId: targetItemId,
      resolutionStatus: outcome.status,
      confidence: outcome.confidence,
      resolutionNote: null,
      resolvedAt: targetItemId || outcome.status !== "unresolved" ? now() : null,
      resolvedBy: targetItemId || outcome.status !== "unresolved" ? "auto" : null,
    });

    if (targetItemId && (outcome.status === "resolved" || outcome.status === "manually_resolved")) {
      await this.ensurePresencePeriod(targetItemId, observation);
    }

    const after = await captureSnapshot(
      this.store,
      targetItemId ? [targetItemId] : [],
      [observationId],
    );

    const decision =
      outcome.status === "unresolved" && !outcome.shouldCreateItem
        ? null
        : await this.store.appendDecision({
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

  async resolveObservationManual(input: {
    observationId: string;
    itemId?: string;
    createNewItem?: boolean;
    actor: string;
    rationale: string;
    idempotencyKey?: string;
  }): Promise<ResolveObservationResult> {
    const parsed = manualResolveInputSchema.parse(input);
    const observation = await this.store.getObservation(parsed.observationId);
    if (!observation) {
      throw new Error(`Observation not found: ${parsed.observationId}`);
    }

    const idempotencyKey =
      parsed.idempotencyKey ?? `manual_resolve:${parsed.observationId}:${parsed.itemId ?? "new"}`;
    const existing = await this.store.findDecisionByIdempotencyKey(idempotencyKey);
    if (existing) {
      return {
        observation: (await this.store.getObservation(parsed.observationId))!,
        decision: existing,
        candidates: await this.store.listCandidates(parsed.observationId),
        createdItem: existing.toItemIds[0]
          ? await this.store.getCanonicalItem(existing.toItemIds[0])
          : null,
      };
    }

    const before = await captureSnapshot(this.store, [], [parsed.observationId]);
    let targetItem: CanonicalItem | null = null;

    if (parsed.createNewItem || !parsed.itemId) {
      targetItem = await this.store.createCanonicalItem({
        displayName: observation.normalizedMetadata.title ?? null,
        category: observation.observedNonce ? "unique_nonce_candidate" : "nonce_less",
        primaryNonce: observation.observedNonce,
        strictFingerprint: observation.strictFingerprint,
        looseFingerprint: observation.looseFingerprint,
      });
      if (observation.observedNonce) {
        await this.store.addIdentifier({
          itemId: targetItem.id,
          kind: "nonce",
          value: observation.observedNonce,
        });
      }
    } else {
      targetItem = await this.store.getCanonicalItem(parsed.itemId);
      if (!targetItem) {
        throw new Error(`Canonical item not found: ${parsed.itemId}`);
      }
    }

    const updatedObservation = await this.store.updateObservationResolution(parsed.observationId, {
      canonicalItemId: targetItem.id,
      resolutionStatus: "manually_resolved",
      confidence: 1,
      resolutionNote: parsed.rationale,
      resolvedAt: now(),
      resolvedBy: "manual",
    });

    await this.ensurePresencePeriod(targetItem.id, observation);

    const after = await captureSnapshot(this.store, [targetItem.id], [parsed.observationId]);
    const decision = await this.store.appendDecision({
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
      candidates: await this.store.listCandidates(parsed.observationId),
      createdItem: parsed.createNewItem ? targetItem : null,
    };
  }

  async mergeItems(input: {
    survivorItemId: string;
    loserItemId: string;
    actor: string;
    rationale: string;
    idempotencyKey?: string;
  }): Promise<IdentityDecision> {
    const parsed = mergeItemsInputSchema.parse(input);
    if (parsed.survivorItemId === parsed.loserItemId) {
      throw new Error("Cannot merge an item with itself");
    }

    const idempotencyKey =
      parsed.idempotencyKey ?? `merge:${parsed.survivorItemId}:${parsed.loserItemId}`;
    const existing = await this.store.findDecisionByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    const survivor = await this.store.getCanonicalItem(parsed.survivorItemId);
    const loser = await this.store.getCanonicalItem(parsed.loserItemId);
    if (!survivor || !loser) {
      throw new Error("Both survivor and loser items must exist");
    }
    if (loser.status === "merged_away") {
      throw new Error("Loser item is already merged away");
    }

    const before = await captureSnapshot(this.store, [survivor.id, loser.id]);

    for (const identifier of await this.store.listIdentifiersForItem(loser.id)) {
      const duplicate = (await this.store.listIdentifiersForItem(survivor.id)).find(
        (row) =>
          row.kind === identifier.kind &&
          row.source === identifier.source &&
          row.value === identifier.value,
      );

      await this.store.invalidateIdentifier(identifier.id);

      if (!duplicate) {
        await this.store.addIdentifier({
          itemId: survivor.id,
          kind: identifier.kind,
          value: identifier.value,
          source: identifier.source,
          confidence: identifier.confidence,
        });
      }
    }

    for (const observation of await this.store.listObservationsForItem(loser.id)) {
      await this.store.updateObservationResolution(observation.id, {
        canonicalItemId: survivor.id,
        resolutionStatus: observation.resolutionStatus,
        confidence: observation.confidence,
        resolutionNote: observation.resolutionNote,
        resolvedAt: observation.resolvedAt,
        resolvedBy: observation.resolvedBy,
      });
    }

    const survivorPeriods = await this.store.listLocationPeriodsForItem(survivor.id);
    const loserPeriods = await this.store.listLocationPeriodsForItem(loser.id);
    for (const loserPeriod of loserPeriods) {
      const contradiction = survivorPeriods.some(
        (survivorPeriod) =>
          survivorPeriod.accountId &&
          loserPeriod.accountId &&
          survivorPeriod.accountId !== loserPeriod.accountId &&
          survivorPeriod.endedAt === null &&
          loserPeriod.endedAt === null,
      );

      await this.store.createLocationPeriod({
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

    await this.store.updateCanonicalItem(loser.id, {
      status: "merged_away",
      mergedIntoItemId: survivor.id,
    });

    const after = await captureSnapshot(this.store, [survivor.id, loser.id]);
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

  async splitItem(input: {
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
  }): Promise<IdentityDecision> {
    const parsed = splitItemInputSchema.parse(input);
    const sourceItem = await this.store.getCanonicalItem(parsed.sourceItemId);
    if (!sourceItem) {
      throw new Error(`Source item not found: ${parsed.sourceItemId}`);
    }

    const idempotencyKey = parsed.idempotencyKey ?? `split:${parsed.sourceItemId}:${parsed.assignments.length}`;
    const existing = await this.store.findDecisionByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    const before = await captureSnapshot(this.store, [sourceItem.id]);
    const targetItems: CanonicalItem[] = [];

    for (const assignment of parsed.assignments) {
      let targetItem: CanonicalItem;
      if (assignment.createNewItem || !assignment.targetItemId) {
        targetItem = await this.store.createCanonicalItem({
          displayName: assignment.displayName ?? null,
          category: sourceItem.category,
          primaryNonce: sourceItem.primaryNonce,
          strictFingerprint: sourceItem.strictFingerprint,
          looseFingerprint: sourceItem.looseFingerprint,
        });
      } else {
        const existingItem = await this.store.getCanonicalItem(assignment.targetItemId);
        if (!existingItem) {
          throw new Error(`Target item not found: ${assignment.targetItemId}`);
        }
        targetItem = existingItem;
      }

      for (const nonceIdentifier of (await this.store.listIdentifiersForItem(sourceItem.id)).filter(
        (identifier) => identifier.kind === "nonce",
      )) {
        await this.store.addIdentifier({
          itemId: targetItem.id,
          kind: "nonce",
          value: nonceIdentifier.value,
        });
      }

      for (const observationId of assignment.observationIds) {
        const observation = await this.store.getObservation(observationId);
        if (!observation) {
          throw new Error(`Observation not found: ${observationId}`);
        }
        await this.store.updateObservationResolution(observationId, {
          canonicalItemId: targetItem.id,
          resolutionStatus: "manually_resolved",
          confidence: 1,
          resolutionNote: parsed.rationale,
          resolvedAt: now(),
          resolvedBy: "manual",
        });
        await this.ensurePresencePeriod(targetItem.id, observation);
      }

      targetItems.push(targetItem);
    }

    await this.store.supersedeLocationPeriodsForItem(sourceItem.id, now());
    await this.store.updateCanonicalItem(sourceItem.id, {
      status: "split_source",
    });

    const after = await captureSnapshot(
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

  async revertDecision(input: {
    decisionId: string;
    actor: string;
    rationale: string;
    idempotencyKey?: string;
  }): Promise<IdentityDecision> {
    const parsed = revertDecisionInputSchema.parse(input);
    const original = await this.store.getDecision(parsed.decisionId);
    if (!original) {
      throw new Error(`Decision not found: ${parsed.decisionId}`);
    }
    if (!isDecisionReversible(original)) {
      throw new Error(`Decision ${parsed.decisionId} is not reversible`);
    }

    const idempotencyKey = parsed.idempotencyKey ?? `revert:${parsed.decisionId}`;
    const existing = await this.store.findDecisionByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    const before = structuredClone(original.afterState);
    await restoreSnapshot(this.store, original.beforeState as unknown as IdentitySnapshot);

    const revertDecision = await this.store.appendDecision({
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

    await this.store.markDecisionReversed(original.id, revertDecision.id);
    return revertDecision;
  }

  private async ensurePresencePeriod(itemId: string, observation: Observation): Promise<void> {
    const openOnAccount = (await this.store.listLocationPeriodsForItem(itemId)).find(
      (period) =>
        period.accountId === observation.accountId &&
        period.endedAt === null &&
        !period.isUnknownGap,
    );

    if (openOnAccount) {
      return;
    }

    await this.store.createLocationPeriod({
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
