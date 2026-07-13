import { and, eq, isNull, sql } from "drizzle-orm";
import {
  DEFAULT_AUTO_RESOLVE_SETTINGS,
  type AutoResolveSettings,
  type BookMetadata,
  type CanonicalItem,
  type IdentityDecision,
  type ItemIdentifier,
  type ItemLocationPeriod,
  type Observation,
  type ObservationCandidate,
} from "@pitantir/shared/identity";
import type { Database } from "../client.js";
import {
  canonicalItems,
  identityDecisions,
  itemIdentifiers,
  itemLocationPeriods,
  observationCandidates,
  observations,
} from "../schema/identity.js";
import { adminSettings } from "../schema/accounts.js";
import {
  type AddIdentifierInput,
  type CreateCanonicalItemInput,
  type CreateObservationInput,
  type IdentityStore,
  newId,
  now,
} from "./store.js";

function mapItem(row: typeof canonicalItems.$inferSelect): CanonicalItem {
  return {
    id: row.id,
    displayName: row.displayName,
    category: row.category,
    identityConfidence: row.identityConfidence,
    primaryNonce: row.primaryNonce,
    strictFingerprint: row.strictFingerprint,
    looseFingerprint: row.looseFingerprint,
    status: row.status,
    mergedIntoItemId: row.mergedIntoItemId,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function mapIdentifier(row: typeof itemIdentifiers.$inferSelect): ItemIdentifier {
  return {
    id: row.id,
    itemId: row.itemId,
    kind: row.kind,
    source: row.source,
    value: row.value,
    isPreferred: row.isPreferred,
    confidence: row.confidence,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    invalidatedAt: row.invalidatedAt,
  };
}

function mapObservation(row: typeof observations.$inferSelect): Observation {
  return {
    id: row.id,
    scanId: row.scanId,
    accountId: row.accountId,
    observedAt: row.observedAt,
    slotKey: row.slotKey,
    rawItem: row.rawItem as Record<string, unknown>,
    observedNonce: row.observedNonce,
    normalizedMetadata: row.normalizedMetadata as BookMetadata,
    strictFingerprint: row.strictFingerprint,
    looseFingerprint: row.looseFingerprint,
    canonicalItemId: row.canonicalItemId,
    resolutionStatus: row.resolutionStatus,
    confidence: row.confidence === null ? null : Number(row.confidence),
    resolutionNote: row.resolutionNote,
    resolvedAt: row.resolvedAt,
    resolvedBy: (row.resolvedBy as Observation["resolvedBy"]) ?? null,
    createdAt: row.createdAt,
  };
}

function mapCandidate(row: typeof observationCandidates.$inferSelect): ObservationCandidate {
  return {
    id: row.id,
    observationId: row.observationId,
    itemId: row.itemId,
    score: Number(row.score),
    reasons: row.reasons as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

function mapDecision(row: typeof identityDecisions.$inferSelect): IdentityDecision {
  return {
    id: row.id,
    decisionType: row.decisionType,
    actor: row.actor,
    observationId: row.observationId,
    importClaimId: row.importClaimId,
    fromItemIds: row.fromItemIds ?? [],
    toItemIds: row.toItemIds ?? [],
    beforeState: row.beforeState as Record<string, unknown>,
    afterState: row.afterState as Record<string, unknown>,
    rationale: row.rationale,
    idempotencyKey: row.idempotencyKey,
    revertsDecisionId: row.revertsDecisionId,
    reversedByDecisionId: row.reversedByDecisionId,
    createdAt: row.createdAt,
  };
}

function mapPeriod(row: typeof itemLocationPeriods.$inferSelect): ItemLocationPeriod {
  return {
    id: row.id,
    itemId: row.itemId,
    accountId: row.accountId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    startReason: row.startReason as ItemLocationPeriod["startReason"],
    endReason: (row.endReason as ItemLocationPeriod["endReason"]) ?? null,
    certainty: row.certainty as ItemLocationPeriod["certainty"],
    isUnknownGap: row.isUnknownGap,
    openingObservationId: row.openingObservationId,
    closingObservationContextScanId: row.closingObservationContextScanId,
    notes: row.notes,
    createdAt: row.createdAt,
    supersededAt: row.supersededAt,
    supersededByPeriodId: row.supersededByPeriodId,
  };
}

export class PostgresIdentityStore implements IdentityStore {
  constructor(private readonly db: Database) {}

  async getSettings(): Promise<AutoResolveSettings> {
    const rows = await this.db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, "auto_resolve"));
    const value = rows[0]?.value;
    if (value && typeof value === "object") {
      return { ...DEFAULT_AUTO_RESOLVE_SETTINGS, ...(value as AutoResolveSettings) };
    }
    return { ...DEFAULT_AUTO_RESOLVE_SETTINGS };
  }

  async createCanonicalItem(input: CreateCanonicalItemInput = {}): Promise<CanonicalItem> {
    const timestamp = now();
    const item = {
      id: newId(),
      displayName: input.displayName ?? null,
      category: input.category ?? ("unknown" as const),
      identityConfidence: input.identityConfidence ?? ("medium" as const),
      primaryNonce: input.primaryNonce ?? null,
      strictFingerprint: input.strictFingerprint ?? null,
      looseFingerprint: input.looseFingerprint ?? null,
      status: "active" as const,
      mergedIntoItemId: null,
      notes: input.notes ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    await this.db.insert(canonicalItems).values(item);
    return mapItem(item);
  }

  async getCanonicalItem(itemId: string): Promise<CanonicalItem | null> {
    const rows = await this.db.select().from(canonicalItems).where(eq(canonicalItems.id, itemId));
    return rows[0] ? mapItem(rows[0]) : null;
  }

  async listActiveCanonicalItems(): Promise<CanonicalItem[]> {
    const rows = await this.db
      .select()
      .from(canonicalItems)
      .where(and(eq(canonicalItems.status, "active"), isNull(canonicalItems.deletedAt)));
    return rows.map(mapItem);
  }

  async updateCanonicalItem(
    itemId: string,
    patch: Partial<CanonicalItem>,
  ): Promise<CanonicalItem> {
    const existing = await this.getCanonicalItem(itemId);
    if (!existing) {
      throw new Error(`Canonical item not found: ${itemId}`);
    }
    const updated = {
      ...existing,
      ...patch,
      id: existing.id,
      updatedAt: now(),
    };
    await this.db
      .update(canonicalItems)
      .set({
        displayName: updated.displayName,
        category: updated.category,
        identityConfidence: updated.identityConfidence,
        primaryNonce: updated.primaryNonce,
        strictFingerprint: updated.strictFingerprint,
        looseFingerprint: updated.looseFingerprint,
        status: updated.status,
        mergedIntoItemId: updated.mergedIntoItemId,
        notes: updated.notes,
        updatedAt: updated.updatedAt,
        deletedAt: updated.deletedAt,
      })
      .where(eq(canonicalItems.id, itemId));
    return updated;
  }

  async addIdentifier(input: AddIdentifierInput): Promise<ItemIdentifier> {
    const item = await this.getCanonicalItem(input.itemId);
    if (!item) {
      throw new Error(`Canonical item not found: ${input.itemId}`);
    }

    if (input.kind === "external_ref") {
      if (!input.source) {
        throw new Error("external_ref identifiers require a source namespace");
      }
      const conflicts = await this.db
        .select()
        .from(itemIdentifiers)
        .where(
          and(
            eq(itemIdentifiers.kind, "external_ref"),
            eq(itemIdentifiers.source, input.source),
            eq(itemIdentifiers.value, input.value),
            isNull(itemIdentifiers.invalidatedAt),
          ),
        );
      const conflict = conflicts[0];
      if (conflict && conflict.itemId !== input.itemId) {
        throw new Error(
          `External ref (${input.source}, ${input.value}) already linked to item ${conflict.itemId}`,
        );
      }
    }

    const duplicates = await this.db
      .select()
      .from(itemIdentifiers)
      .where(
        and(
          eq(itemIdentifiers.itemId, input.itemId),
          eq(itemIdentifiers.kind, input.kind),
          input.source == null
            ? isNull(itemIdentifiers.source)
            : eq(itemIdentifiers.source, input.source),
          eq(itemIdentifiers.value, input.value),
          isNull(itemIdentifiers.invalidatedAt),
        ),
      );
    if (duplicates[0]) {
      return mapIdentifier(duplicates[0]);
    }

    const timestamp = now();
    const identifier = {
      id: newId(),
      itemId: input.itemId,
      kind: input.kind,
      source: input.source ?? null,
      value: input.value,
      isPreferred: input.isPreferred ?? false,
      confidence: input.confidence ?? ("medium" as const),
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      createdAt: timestamp,
      invalidatedAt: null,
    };
    await this.db.insert(itemIdentifiers).values(identifier);
    return mapIdentifier(identifier);
  }

  async listIdentifiersForItem(itemId: string): Promise<ItemIdentifier[]> {
    const rows = await this.db
      .select()
      .from(itemIdentifiers)
      .where(and(eq(itemIdentifiers.itemId, itemId), isNull(itemIdentifiers.invalidatedAt)));
    return rows.map(mapIdentifier);
  }

  async listIdentifiersByKindValue(
    kind: ItemIdentifier["kind"],
    value: string,
  ): Promise<ItemIdentifier[]> {
    const rows = await this.db
      .select()
      .from(itemIdentifiers)
      .where(
        and(
          eq(itemIdentifiers.kind, kind),
          eq(itemIdentifiers.value, value),
          isNull(itemIdentifiers.invalidatedAt),
        ),
      );
    return rows.map(mapIdentifier);
  }

  async invalidateIdentifier(identifierId: string): Promise<ItemIdentifier> {
    const rows = await this.db
      .select()
      .from(itemIdentifiers)
      .where(eq(itemIdentifiers.id, identifierId));
    const identifier = rows[0];
    if (!identifier) {
      throw new Error(`Identifier not found: ${identifierId}`);
    }
    const invalidatedAt = now();
    await this.db
      .update(itemIdentifiers)
      .set({ invalidatedAt })
      .where(eq(itemIdentifiers.id, identifierId));
    return mapIdentifier({ ...identifier, invalidatedAt });
  }

  async createObservation(input: CreateObservationInput): Promise<Observation> {
    const existing = await this.db
      .select()
      .from(observations)
      .where(and(eq(observations.scanId, input.scanId), eq(observations.slotKey, input.slotKey)));
    if (existing[0]) {
      return mapObservation(existing[0]);
    }

    const observation = {
      id: newId(),
      scanId: input.scanId,
      accountId: input.accountId,
      observedAt: input.observedAt,
      slotKey: input.slotKey,
      rawItem: input.rawItem,
      observedNonce: input.observedNonce,
      normalizedMetadata: input.normalizedMetadata,
      strictFingerprint: input.strictFingerprint,
      looseFingerprint: input.looseFingerprint,
      canonicalItemId: null,
      resolutionStatus: "unresolved" as const,
      confidence: null,
      resolutionNote: null,
      resolvedAt: null,
      resolvedBy: null,
      createdAt: now(),
    };
    await this.db.insert(observations).values(observation);
    return mapObservation(observation);
  }

  async getObservation(observationId: string): Promise<Observation | null> {
    const rows = await this.db.select().from(observations).where(eq(observations.id, observationId));
    return rows[0] ? mapObservation(rows[0]) : null;
  }

  async listObservationsForItem(itemId: string): Promise<Observation[]> {
    const rows = await this.db
      .select()
      .from(observations)
      .where(eq(observations.canonicalItemId, itemId));
    return rows.map(mapObservation);
  }

  async listObservationsForScan(scanId: string): Promise<Observation[]> {
    const rows = await this.db.select().from(observations).where(eq(observations.scanId, scanId));
    return rows.map(mapObservation).sort((a, b) => a.slotKey.localeCompare(b.slotKey));
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
    const existing = await this.getObservation(observationId);
    if (!existing) {
      throw new Error(`Observation not found: ${observationId}`);
    }
    await this.db
      .update(observations)
      .set({
        canonicalItemId: patch.canonicalItemId,
        resolutionStatus: patch.resolutionStatus,
        confidence: patch.confidence === null ? null : String(patch.confidence),
        resolutionNote: patch.resolutionNote,
        resolvedAt: patch.resolvedAt,
        resolvedBy: patch.resolvedBy,
      })
      .where(eq(observations.id, observationId));
    return { ...existing, ...patch };
  }

  async upsertObservationCandidates(
    observationId: string,
    candidateRows: Array<{ itemId: string; score: number; reasons: Record<string, unknown> }>,
  ): Promise<ObservationCandidate[]> {
    await this.db
      .delete(observationCandidates)
      .where(eq(observationCandidates.observationId, observationId));

    if (candidateRows.length === 0) {
      return [];
    }

    const created = candidateRows.map((row) => ({
      id: newId(),
      observationId,
      itemId: row.itemId,
      score: String(row.score),
      reasons: row.reasons,
      createdAt: now(),
    }));
    await this.db.insert(observationCandidates).values(created);
    return created.map((row) =>
      mapCandidate({
        ...row,
        score: row.score,
      }),
    );
  }

  async listCandidates(observationId: string): Promise<ObservationCandidate[]> {
    const rows = await this.db
      .select()
      .from(observationCandidates)
      .where(eq(observationCandidates.observationId, observationId));
    return rows.map(mapCandidate);
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

    const row = {
      id: decision.id ?? newId(),
      decisionType: decision.decisionType,
      actor: decision.actor,
      observationId: decision.observationId,
      importClaimId: decision.importClaimId,
      fromItemIds: [...decision.fromItemIds],
      toItemIds: [...decision.toItemIds],
      beforeState: decision.beforeState,
      afterState: decision.afterState,
      rationale: decision.rationale,
      idempotencyKey: decision.idempotencyKey,
      revertsDecisionId: decision.revertsDecisionId,
      reversedByDecisionId: null,
      createdAt: now(),
    };
    await this.db.insert(identityDecisions).values(row);
    return mapDecision(row);
  }

  async getDecision(decisionId: string): Promise<IdentityDecision | null> {
    const rows = await this.db
      .select()
      .from(identityDecisions)
      .where(eq(identityDecisions.id, decisionId));
    return rows[0] ? mapDecision(rows[0]) : null;
  }

  async findDecisionByIdempotencyKey(key: string): Promise<IdentityDecision | null> {
    const rows = await this.db
      .select()
      .from(identityDecisions)
      .where(eq(identityDecisions.idempotencyKey, key));
    return rows[0] ? mapDecision(rows[0]) : null;
  }

  async markDecisionReversed(decisionId: string, reversingDecisionId: string): Promise<void> {
    await this.db
      .update(identityDecisions)
      .set({ reversedByDecisionId: reversingDecisionId })
      .where(eq(identityDecisions.id, decisionId));
  }

  async listLocationPeriodsForItem(itemId: string): Promise<ItemLocationPeriod[]> {
    const rows = await this.db
      .select()
      .from(itemLocationPeriods)
      .where(and(eq(itemLocationPeriods.itemId, itemId), isNull(itemLocationPeriods.supersededAt)));
    return rows.map(mapPeriod);
  }

  async listOpenPresenceOnAccount(accountId: string): Promise<ItemLocationPeriod[]> {
    const rows = await this.db
      .select()
      .from(itemLocationPeriods)
      .where(
        and(
          eq(itemLocationPeriods.accountId, accountId),
          isNull(itemLocationPeriods.endedAt),
          isNull(itemLocationPeriods.supersededAt),
          eq(itemLocationPeriods.isUnknownGap, false),
        ),
      );
    return rows.map(mapPeriod);
  }

  async supersedeLocationPeriodsForItem(itemId: string, supersededAt: Date): Promise<void> {
    await this.db
      .update(itemLocationPeriods)
      .set({ supersededAt })
      .where(and(eq(itemLocationPeriods.itemId, itemId), isNull(itemLocationPeriods.supersededAt)));
  }

  async createLocationPeriod(
    period: Omit<ItemLocationPeriod, "id" | "createdAt" | "supersededAt" | "supersededByPeriodId">,
  ): Promise<ItemLocationPeriod> {
    const row = {
      ...period,
      id: newId(),
      createdAt: now(),
      supersededAt: null,
      supersededByPeriodId: null,
    };
    await this.db.insert(itemLocationPeriods).values(row);
    return mapPeriod(row);
  }
}

export async function seedAdminSettings(db: Database): Promise<void> {
  const existing = await db.select().from(adminSettings).where(eq(adminSettings.key, "auto_resolve"));
  if (existing[0]) {
    return;
  }
  await db.insert(adminSettings).values([
    {
      key: "auto_resolve",
      value: DEFAULT_AUTO_RESOLVE_SETTINGS,
      updatedAt: now(),
    },
    {
      key: "scan_default_interval_seconds",
      value: 3600,
      updatedAt: now(),
    },
  ]);
}

export { sql };
