import { randomUUID } from "node:crypto";
import type {
  AutoResolveSettings,
  CanonicalItem,
  IdentityDecision,
  ItemIdentifier,
  ItemLocationPeriod,
  Observation,
  ObservationCandidate,
} from "@pitantir/shared/identity";

export interface CreateCanonicalItemInput {
  displayName?: string | null;
  category?: CanonicalItem["category"];
  identityConfidence?: CanonicalItem["identityConfidence"];
  primaryNonce?: string | null;
  strictFingerprint?: string | null;
  looseFingerprint?: string | null;
  notes?: string | null;
}

export interface AddIdentifierInput {
  itemId: string;
  kind: ItemIdentifier["kind"];
  value: string;
  source?: string | null;
  confidence?: ItemIdentifier["confidence"];
  isPreferred?: boolean;
}

export interface CreateObservationInput {
  scanId: string;
  accountId: string;
  observedAt: Date;
  slotKey: string;
  rawItem: Record<string, unknown>;
  observedNonce: string | null;
  normalizedMetadata: Observation["normalizedMetadata"];
  strictFingerprint: string;
  looseFingerprint: string;
}

export interface IdentityStore {
  getSettings(): AutoResolveSettings;
  createCanonicalItem(input?: CreateCanonicalItemInput): CanonicalItem;
  getCanonicalItem(itemId: string): CanonicalItem | null;
  listActiveCanonicalItems(): CanonicalItem[];
  updateCanonicalItem(itemId: string, patch: Partial<CanonicalItem>): CanonicalItem;

  addIdentifier(input: AddIdentifierInput): ItemIdentifier;
  listIdentifiersForItem(itemId: string): ItemIdentifier[];
  listIdentifiersByKindValue(kind: ItemIdentifier["kind"], value: string): ItemIdentifier[];
  invalidateIdentifier(identifierId: string): ItemIdentifier;

  createObservation(input: CreateObservationInput): Observation;
  getObservation(observationId: string): Observation | null;
  listObservationsForItem(itemId: string): Observation[];
  updateObservationResolution(
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
  ): Observation;

  upsertObservationCandidates(
    observationId: string,
    candidates: Array<{ itemId: string; score: number; reasons: Record<string, unknown> }>,
  ): ObservationCandidate[];
  listCandidates(observationId: string): ObservationCandidate[];

  appendDecision(
    decision: Omit<
      IdentityDecision,
      "id" | "createdAt" | "reversedByDecisionId"
    > & { id?: string },
  ): IdentityDecision;
  getDecision(decisionId: string): IdentityDecision | null;
  findDecisionByIdempotencyKey(key: string): IdentityDecision | null;
  markDecisionReversed(decisionId: string, reversingDecisionId: string): void;

  listLocationPeriodsForItem(itemId: string): ItemLocationPeriod[];
  listOpenPresenceOnAccount(accountId: string): ItemLocationPeriod[];
  supersedeLocationPeriodsForItem(itemId: string, supersededAt: Date): void;
  createLocationPeriod(
    period: Omit<ItemLocationPeriod, "id" | "createdAt" | "supersededAt" | "supersededByPeriodId">,
  ): ItemLocationPeriod;
}

export function newId(): string {
  return randomUUID();
}

export function now(): Date {
  return new Date();
}
