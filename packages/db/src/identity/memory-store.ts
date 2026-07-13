import {
  DEFAULT_AUTO_RESOLVE_SETTINGS,
  type AutoResolveSettings,
  type CanonicalItem,
  type IdentityDecision,
  type ItemIdentifier,
  type ItemLocationPeriod,
  type Observation,
  type ObservationCandidate,
} from "@pitantir/shared/identity";
import {
  type AddIdentifierInput,
  type CreateCanonicalItemInput,
  type CreateObservationInput,
  type IdentityStore,
  newId,
  now,
} from "./store.js";

export class MemoryIdentityStore implements IdentityStore {
  private settings: AutoResolveSettings = { ...DEFAULT_AUTO_RESOLVE_SETTINGS };
  private items = new Map<string, CanonicalItem>();
  private identifiers = new Map<string, ItemIdentifier>();
  private observations = new Map<string, Observation>();
  private candidates = new Map<string, ObservationCandidate>();
  private decisions = new Map<string, IdentityDecision>();
  private periods = new Map<string, ItemLocationPeriod>();

  async getSettings(): Promise<AutoResolveSettings> {
    return { ...this.settings };
  }

  setSettings(settings: Partial<AutoResolveSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  async createCanonicalItem(input: CreateCanonicalItemInput = {}): Promise<CanonicalItem> {
    const timestamp = now();
    const item: CanonicalItem = {
      id: newId(),
      displayName: input.displayName ?? null,
      category: input.category ?? "unknown",
      identityConfidence: input.identityConfidence ?? "medium",
      primaryNonce: input.primaryNonce ?? null,
      strictFingerprint: input.strictFingerprint ?? null,
      looseFingerprint: input.looseFingerprint ?? null,
      status: "active",
      mergedIntoItemId: null,
      notes: input.notes ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    this.items.set(item.id, item);
    return item;
  }

  async getCanonicalItem(itemId: string): Promise<CanonicalItem | null> {
    return this.items.get(itemId) ?? null;
  }

  async listActiveCanonicalItems(): Promise<CanonicalItem[]> {
    return [...this.items.values()].filter(
      (item) => item.status === "active" && item.deletedAt === null,
    );
  }

  async updateCanonicalItem(itemId: string, patch: Partial<CanonicalItem>): Promise<CanonicalItem> {
    const existing = this.items.get(itemId);
    if (!existing) {
      throw new Error(`Canonical item not found: ${itemId}`);
    }
    const updated: CanonicalItem = {
      ...existing,
      ...patch,
      id: existing.id,
      updatedAt: now(),
    };
    this.items.set(itemId, updated);
    return updated;
  }

  async addIdentifier(input: AddIdentifierInput): Promise<ItemIdentifier> {
    const item = this.items.get(input.itemId);
    if (!item) {
      throw new Error(`Canonical item not found: ${input.itemId}`);
    }

    if (input.kind === "external_ref") {
      if (!input.source) {
        throw new Error("external_ref identifiers require a source namespace");
      }
      const conflict = [...this.identifiers.values()].find(
        (identifier) =>
          identifier.kind === "external_ref" &&
          identifier.source === input.source &&
          identifier.value === input.value &&
          identifier.invalidatedAt === null,
      );
      if (conflict && conflict.itemId !== input.itemId) {
        throw new Error(
          `External ref (${input.source}, ${input.value}) already linked to item ${conflict.itemId}`,
        );
      }
    }

    const duplicate = [...this.identifiers.values()].find(
      (identifier) =>
        identifier.itemId === input.itemId &&
        identifier.kind === input.kind &&
        identifier.source === (input.source ?? null) &&
        identifier.value === input.value &&
        identifier.invalidatedAt === null,
    );
    if (duplicate) {
      return duplicate;
    }

    const timestamp = now();
    const identifier: ItemIdentifier = {
      id: newId(),
      itemId: input.itemId,
      kind: input.kind,
      source: input.source ?? null,
      value: input.value,
      isPreferred: input.isPreferred ?? false,
      confidence: input.confidence ?? "medium",
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      createdAt: timestamp,
      invalidatedAt: null,
    };
    this.identifiers.set(identifier.id, identifier);
    return identifier;
  }

  async listIdentifiersForItem(itemId: string): Promise<ItemIdentifier[]> {
    return [...this.identifiers.values()].filter(
      (identifier) => identifier.itemId === itemId && identifier.invalidatedAt === null,
    );
  }

  async listIdentifiersByKindValue(kind: ItemIdentifier["kind"], value: string): Promise<ItemIdentifier[]> {
    return [...this.identifiers.values()].filter(
      (identifier) =>
        identifier.kind === kind && identifier.value === value && identifier.invalidatedAt === null,
    );
  }

  async invalidateIdentifier(identifierId: string): Promise<ItemIdentifier> {
    const identifier = this.identifiers.get(identifierId);
    if (!identifier) {
      throw new Error(`Identifier not found: ${identifierId}`);
    }
    const updated = { ...identifier, invalidatedAt: now() };
    this.identifiers.set(identifierId, updated);
    return updated;
  }

  async createObservation(input: CreateObservationInput): Promise<Observation> {
    const duplicate = [...this.observations.values()].find(
      (observation) =>
        observation.scanId === input.scanId && observation.slotKey === input.slotKey,
    );
    if (duplicate) {
      return duplicate;
    }

    const observation: Observation = {
      id: newId(),
      scanId: input.scanId,
      accountId: input.accountId,
      observedAt: input.observedAt,
      slotKey: input.slotKey,
      rawItem: structuredClone(input.rawItem),
      observedNonce: input.observedNonce,
      normalizedMetadata: structuredClone(input.normalizedMetadata),
      strictFingerprint: input.strictFingerprint,
      looseFingerprint: input.looseFingerprint,
      canonicalItemId: null,
      resolutionStatus: "unresolved",
      confidence: null,
      resolutionNote: null,
      resolvedAt: null,
      resolvedBy: null,
      createdAt: now(),
    };
    this.observations.set(observation.id, observation);
    return observation;
  }

  async getObservation(observationId: string): Promise<Observation | null> {
    return this.observations.get(observationId) ?? null;
  }

  async listObservationsForItem(itemId: string): Promise<Observation[]> {
    return [...this.observations.values()].filter(
      (observation) => observation.canonicalItemId === itemId,
    );
  }

  async listObservationsForScan(scanId: string): Promise<Observation[]> {
    return [...this.observations.values()]
      .filter((observation) => observation.scanId === scanId)
      .sort((a, b) => a.slotKey.localeCompare(b.slotKey));
  }

  async updateObservationResolution(
    observationId: string,
    patch: Pick<
      Observation,
      | "canonicalItemId"
      | "resolutionStatus"
      | "confidence"
      | "resolutionNote"
      | "resolvedAt"
      | "resolvedBy"
    >,
  ): Promise<Observation> {
    const observation = this.observations.get(observationId);
    if (!observation) {
      throw new Error(`Observation not found: ${observationId}`);
    }

    const updated: Observation = {
      ...observation,
      canonicalItemId: patch.canonicalItemId,
      resolutionStatus: patch.resolutionStatus,
      confidence: patch.confidence,
      resolutionNote: patch.resolutionNote,
      resolvedAt: patch.resolvedAt,
      resolvedBy: patch.resolvedBy,
    };
    this.observations.set(observationId, updated);
    return updated;
  }

  async upsertObservationCandidates(
    observationId: string,
    candidateRows: Array<{ itemId: string; score: number; reasons: Record<string, unknown> }>,
  ): Promise<ObservationCandidate[]> {
    for (const [candidateId, candidate] of this.candidates.entries()) {
      if (candidate.observationId === observationId) {
        this.candidates.delete(candidateId);
      }
    }

    const created = candidateRows.map((row) => {
      const candidate: ObservationCandidate = {
        id: newId(),
        observationId,
        itemId: row.itemId,
        score: row.score,
        reasons: structuredClone(row.reasons),
        createdAt: now(),
      };
      this.candidates.set(candidate.id, candidate);
      return candidate;
    });

    return created;
  }

  async listCandidates(observationId: string): Promise<ObservationCandidate[]> {
    return [...this.candidates.values()].filter(
      (candidate) => candidate.observationId === observationId,
    );
  }

  async appendDecision(
    decision: Omit<IdentityDecision, "id" | "createdAt" | "reversedByDecisionId"> & {
      id?: string;
    },
  ): Promise<IdentityDecision> {
    if (decision.idempotencyKey) {
      const existing = await this.findDecisionByIdempotencyKey(decision.idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    const row: IdentityDecision = {
      id: decision.id ?? newId(),
      decisionType: decision.decisionType,
      actor: decision.actor,
      observationId: decision.observationId,
      importClaimId: decision.importClaimId,
      fromItemIds: [...decision.fromItemIds],
      toItemIds: [...decision.toItemIds],
      beforeState: structuredClone(decision.beforeState),
      afterState: structuredClone(decision.afterState),
      rationale: decision.rationale,
      idempotencyKey: decision.idempotencyKey,
      revertsDecisionId: decision.revertsDecisionId,
      reversedByDecisionId: null,
      createdAt: now(),
    };
    this.decisions.set(row.id, row);
    return row;
  }

  async getDecision(decisionId: string): Promise<IdentityDecision | null> {
    return this.decisions.get(decisionId) ?? null;
  }

  async findDecisionByIdempotencyKey(key: string): Promise<IdentityDecision | null> {
    return (
      [...this.decisions.values()].find((decision) => decision.idempotencyKey === key) ?? null
    );
  }

  async markDecisionReversed(decisionId: string, reversingDecisionId: string): Promise<void> {
    const decision = this.decisions.get(decisionId);
    if (!decision) {
      throw new Error(`Decision not found: ${decisionId}`);
    }
    this.decisions.set(decisionId, {
      ...decision,
      reversedByDecisionId: reversingDecisionId,
    });
  }

  async listLocationPeriodsForItem(itemId: string): Promise<ItemLocationPeriod[]> {
    return [...this.periods.values()].filter(
      (period) => period.itemId === itemId && period.supersededAt === null,
    );
  }

  async listOpenPresenceOnAccount(accountId: string): Promise<ItemLocationPeriod[]> {
    return [...this.periods.values()].filter(
      (period) =>
        period.accountId === accountId &&
        period.endedAt === null &&
        period.supersededAt === null &&
        !period.isUnknownGap,
    );
  }

  async supersedeLocationPeriodsForItem(itemId: string, supersededAt: Date): Promise<void> {
    for (const [periodId, period] of this.periods.entries()) {
      if (period.itemId === itemId && period.supersededAt === null) {
        this.periods.set(periodId, { ...period, supersededAt });
      }
    }
  }

  async createLocationPeriod(
    period: Omit<ItemLocationPeriod, "id" | "createdAt" | "supersededAt" | "supersededByPeriodId">,
  ): Promise<ItemLocationPeriod> {
    const row: ItemLocationPeriod = {
      ...period,
      id: newId(),
      createdAt: now(),
      supersededAt: null,
      supersededByPeriodId: null,
    };
    this.periods.set(row.id, row);
    return row;
  }
}
