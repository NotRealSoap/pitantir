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
  getSettings(): Promise<AutoResolveSettings>;
  createCanonicalItem(input?: CreateCanonicalItemInput): Promise<CanonicalItem>;
  getCanonicalItem(itemId: string): Promise<CanonicalItem | null>;
  listActiveCanonicalItems(): Promise<CanonicalItem[]>;
  updateCanonicalItem(itemId: string, patch: Partial<CanonicalItem>): Promise<CanonicalItem>;

  addIdentifier(input: AddIdentifierInput): Promise<ItemIdentifier>;
  listIdentifiersForItem(itemId: string): Promise<ItemIdentifier[]>;
  listIdentifiersByKindValue(
    kind: ItemIdentifier["kind"],
    value: string,
  ): Promise<ItemIdentifier[]>;
  invalidateIdentifier(identifierId: string): Promise<ItemIdentifier>;

  createObservation(input: CreateObservationInput): Promise<Observation>;
  getObservation(observationId: string): Promise<Observation | null>;
  listObservationsForItem(itemId: string): Promise<Observation[]>;
  listObservationsForScan(scanId: string): Promise<Observation[]>;
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
  ): Promise<Observation>;

  upsertObservationCandidates(
    observationId: string,
    candidates: Array<{ itemId: string; score: number; reasons: Record<string, unknown> }>,
  ): Promise<ObservationCandidate[]>;
  listCandidates(observationId: string): Promise<ObservationCandidate[]>;

  appendDecision(
    decision: Omit<IdentityDecision, "id" | "createdAt" | "reversedByDecisionId"> & {
      id?: string;
    },
  ): Promise<IdentityDecision>;
  getDecision(decisionId: string): Promise<IdentityDecision | null>;
  findDecisionByIdempotencyKey(key: string): Promise<IdentityDecision | null>;
  markDecisionReversed(decisionId: string, reversingDecisionId: string): Promise<void>;

  listLocationPeriodsForItem(itemId: string): Promise<ItemLocationPeriod[]>;
  listOpenPresenceOnAccount(accountId: string): Promise<ItemLocationPeriod[]>;
  supersedeLocationPeriodsForItem(itemId: string, supersededAt: Date): Promise<void>;
  createLocationPeriod(
    period: Omit<ItemLocationPeriod, "id" | "createdAt" | "supersededAt" | "supersededByPeriodId">,
  ): Promise<ItemLocationPeriod>;
}

export function newId(): string {
  return randomUUID();
}

export function now(): Date {
  return new Date();
}
