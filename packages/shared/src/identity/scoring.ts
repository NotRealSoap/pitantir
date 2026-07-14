import type { CandidateScore, CanonicalItem, ItemIdentifier, Observation } from "./types.js";

export interface ScoringContext {
  observation: Observation;
  candidates: CanonicalItem[];
  identifiersByItemId: Map<string, ItemIdentifier[]>;
  nonceCollidingItemIds: Set<string>;
  openPresenceOnAccountItemIds: Set<string>;
}

const WEIGHTS = {
  uniqueNonce: 0.95,
  collidingNonce: 0.45,
  strictFingerprint: 0.8,
  looseFingerprint: 0.35,
  continuityOnAccount: 0.55,
} as const;

export function scoreCandidate(context: ScoringContext, item: CanonicalItem): CandidateScore {
  const reasons: Record<string, unknown> = {};
  let score = 0;

  const identifiers = context.identifiersByItemId.get(item.id) ?? [];
  const nonce = context.observation.observedNonce;

  if (nonce) {
    const hasNonce = identifiers.some(
      (identifier) => identifier.kind === "nonce" && identifier.value === nonce && !identifier.invalidatedAt,
    );
    if (hasNonce) {
      const colliding = context.nonceCollidingItemIds.has(item.id);
      const weight = colliding ? WEIGHTS.collidingNonce : WEIGHTS.uniqueNonce;
      score += weight;
      reasons.nonceMatch = { colliding, weight };
    }
  }

  if (context.observation.strictFingerprint && item.strictFingerprint === context.observation.strictFingerprint) {
    score += WEIGHTS.strictFingerprint;
    reasons.strictFingerprintMatch = true;
  }

  if (context.observation.looseFingerprint && item.looseFingerprint === context.observation.looseFingerprint) {
    score += WEIGHTS.looseFingerprint;
    reasons.looseFingerprintMatch = true;
  }

  if (context.openPresenceOnAccountItemIds.has(item.id)) {
    score += WEIGHTS.continuityOnAccount;
    reasons.continuityOnAccount = true;
  }

  return {
    itemId: item.id,
    score: Math.min(score, 1),
    reasons,
  };
}

export function rankCandidates(context: ScoringContext): CandidateScore[] {
  return context.candidates
    .map((item) => scoreCandidate(context, item))
    .sort((left, right) => right.score - left.score);
}

export function hasNonceCollision(
  candidateItemIds: string[],
  nonce: string | null,
  identifiersByItemId: Map<string, ItemIdentifier[]>,
): boolean {
  if (!nonce) {
    return false;
  }

  const matching = candidateItemIds.filter((itemId) =>
    (identifiersByItemId.get(itemId) ?? []).some(
      (identifier) =>
        identifier.kind === "nonce" &&
        identifier.value === nonce &&
        !identifier.invalidatedAt,
    ),
  );

  return matching.length >= 2;
}
