import type {
  DecisionType,
  IdentifierConfidence,
  IdentifierKind,
  IdentityConfidence,
  ItemCategory,
  ItemStatus,
  LocationEventType,
  PeriodCertainty,
  PeriodEndReason,
  PeriodStartReason,
  ResolutionStatus,
  ResolvedBy,
} from "./enums.js";

export interface BookMetadata {
  title?: string | null;
  author?: string | null;
  pageCount?: number | null;
  pageContentHash?: string | null;
  generation?: string | null;
}

export interface CanonicalItem {
  id: string;
  displayName: string | null;
  category: ItemCategory;
  identityConfidence: IdentityConfidence;
  primaryNonce: string | null;
  strictFingerprint: string | null;
  looseFingerprint: string | null;
  status: ItemStatus;
  mergedIntoItemId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ItemIdentifier {
  id: string;
  itemId: string;
  kind: IdentifierKind;
  source: string | null;
  value: string;
  isPreferred: boolean;
  confidence: IdentifierConfidence;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  invalidatedAt: Date | null;
}

export interface Observation {
  id: string;
  scanId: string;
  accountId: string;
  observedAt: Date;
  slotKey: string;
  rawItem: Record<string, unknown>;
  observedNonce: string | null;
  normalizedMetadata: BookMetadata;
  strictFingerprint: string;
  looseFingerprint: string;
  canonicalItemId: string | null;
  resolutionStatus: ResolutionStatus;
  confidence: number | null;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  resolvedBy: ResolvedBy | null;
  createdAt: Date;
}

export interface ObservationCandidate {
  id: string;
  observationId: string;
  itemId: string;
  score: number;
  reasons: Record<string, unknown>;
  createdAt: Date;
}

export interface IdentityDecision {
  id: string;
  decisionType: DecisionType;
  actor: string;
  observationId: string | null;
  importClaimId: string | null;
  fromItemIds: string[];
  toItemIds: string[];
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  rationale: string | null;
  idempotencyKey: string | null;
  revertsDecisionId: string | null;
  reversedByDecisionId: string | null;
  createdAt: Date;
}

export interface ItemLocationPeriod {
  id: string;
  itemId: string;
  accountId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  startReason: PeriodStartReason;
  endReason: PeriodEndReason | null;
  certainty: PeriodCertainty;
  isUnknownGap: boolean;
  openingObservationId: string | null;
  closingObservationContextScanId: string | null;
  notes: string | null;
  createdAt: Date;
  supersededAt: Date | null;
  supersededByPeriodId: string | null;
}

export interface ItemLocationEvent {
  id: string;
  itemId: string;
  eventType: LocationEventType;
  fromAccountId: string | null;
  toAccountId: string | null;
  eventTime: Date;
  certainty: PeriodCertainty;
  scanId: string | null;
  observationId: string | null;
  periodId: string | null;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface CandidateScore {
  itemId: string;
  score: number;
  reasons: Record<string, unknown>;
}

export interface AutoResolveSettings {
  autoCreateOnNovelNonce: boolean;
  autoCreateNonceLess: boolean;
  autoResolveThreshold: number;
  probableThreshold: number;
}

export const DEFAULT_AUTO_RESOLVE_SETTINGS: AutoResolveSettings = {
  autoCreateOnNovelNonce: true,
  autoCreateNonceLess: false,
  autoResolveThreshold: 0.85,
  probableThreshold: 0.6,
};

export interface ResolveObservationResult {
  observation: Observation;
  decision: IdentityDecision | null;
  candidates: ObservationCandidate[];
  createdItem: CanonicalItem | null;
}
