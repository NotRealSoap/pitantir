import { hasNonceCollision, rankCandidates } from "./scoring.js";
import type {
  AutoResolveSettings,
  BookMetadata,
  CanonicalItem,
  CandidateScore,
  ItemIdentifier,
  Observation,
} from "./types.js";
import type { ResolutionStatus } from "./enums.js";
import { DEFAULT_AUTO_RESOLVE_SETTINGS } from "./types.js";

export interface AutoResolveInput {
  observation: Observation;
  activeItems: CanonicalItem[];
  identifiersByItemId: Map<string, ItemIdentifier[]>;
  openPresenceOnAccountItemIds: Set<string>;
  settings?: AutoResolveSettings;
}

export interface AutoResolveOutcome {
  status: ResolutionStatus;
  canonicalItemId: string | null;
  confidence: number | null;
  candidates: CandidateScore[];
  shouldCreateItem: boolean;
  createdItemCategory: CanonicalItem["category"];
}

function recallCandidates(
  observation: Observation,
  activeItems: CanonicalItem[],
  identifiersByItemId: Map<string, ItemIdentifier[]>,
): CanonicalItem[] {
  const recalled = new Map<string, CanonicalItem>();

  for (const item of activeItems) {
    if (item.status !== "active" || item.deletedAt) {
      continue;
    }

    const identifiers = identifiersByItemId.get(item.id) ?? [];
    const nonceMatch =
      observation.observedNonce &&
      identifiers.some(
        (identifier) =>
          identifier.kind === "nonce" &&
          identifier.value === observation.observedNonce &&
          !identifier.invalidatedAt,
      );
    const strictMatch = item.strictFingerprint === observation.strictFingerprint;
    const looseMatch = item.looseFingerprint === observation.looseFingerprint;

    if (nonceMatch || strictMatch || looseMatch) {
      recalled.set(item.id, item);
    }
  }

  return [...recalled.values()];
}

export function autoResolveObservation(input: AutoResolveInput): AutoResolveOutcome {
  const settings = input.settings ?? DEFAULT_AUTO_RESOLVE_SETTINGS;
  const recalled = recallCandidates(
    input.observation,
    input.activeItems,
    input.identifiersByItemId,
  );

  const nonceCollidingItemIds = new Set(
    recalled
      .filter((item) =>
        (input.identifiersByItemId.get(item.id) ?? []).some(
          (identifier) =>
            identifier.kind === "nonce" &&
            identifier.value === input.observation.observedNonce &&
            !identifier.invalidatedAt,
        ),
      )
      .map((item) => item.id),
  );

  const candidates = rankCandidates({
    observation: input.observation,
    candidates: recalled,
    identifiersByItemId: input.identifiersByItemId,
    nonceCollidingItemIds,
    openPresenceOnAccountItemIds: input.openPresenceOnAccountItemIds,
  });

  const nonceCollision =
    input.observation.observedNonce &&
    hasNonceCollision(
      recalled.map((item) => item.id),
      input.observation.observedNonce,
      input.identifiersByItemId,
    );

  if (nonceCollision && recalled.length >= 2) {
    const continuityMatches = recalled.filter((item) =>
      input.openPresenceOnAccountItemIds.has(item.id),
    );

    if (continuityMatches.length === 1) {
      const top = candidates.find((candidate) => candidate.itemId === continuityMatches[0]!.id);
      return {
        status: "resolved",
        canonicalItemId: continuityMatches[0]!.id,
        confidence: top?.score ?? settings.autoResolveThreshold,
        candidates,
        shouldCreateItem: false,
        createdItemCategory: "duplicate_nonce",
      };
    }

    return {
      status: "ambiguous",
      canonicalItemId: null,
      confidence: candidates[0]?.score ?? null,
      candidates,
      shouldCreateItem: false,
      createdItemCategory: "duplicate_nonce",
    };
  }

  if (candidates.length === 0) {
    if (input.observation.observedNonce && settings.autoCreateOnNovelNonce) {
      return {
        status: "resolved",
        canonicalItemId: null,
        confidence: 1,
        candidates,
        shouldCreateItem: true,
        createdItemCategory: "unique_nonce_candidate",
      };
    }

    if (!input.observation.observedNonce && settings.autoCreateNonceLess) {
      return {
        status: "resolved",
        canonicalItemId: null,
        confidence: 0.7,
        candidates,
        shouldCreateItem: true,
        createdItemCategory: "nonce_less",
      };
    }

    return {
      status: "unresolved",
      canonicalItemId: null,
      confidence: null,
      candidates,
      shouldCreateItem: false,
      createdItemCategory: "unknown",
    };
  }

  const [top, second] = candidates;
  if (!top) {
    return {
      status: "unresolved",
      canonicalItemId: null,
      confidence: null,
      candidates,
      shouldCreateItem: false,
      createdItemCategory: "unknown",
    };
  }

  if (second && Math.abs(top.score - second.score) < 0.05 && top.score >= settings.probableThreshold) {
    return {
      status: "ambiguous",
      canonicalItemId: null,
      confidence: top.score,
      candidates,
      shouldCreateItem: false,
      createdItemCategory: "unknown",
    };
  }

  if (top.score >= settings.autoResolveThreshold) {
    return {
      status: "resolved",
      canonicalItemId: top.itemId,
      confidence: top.score,
      candidates,
      shouldCreateItem: false,
      createdItemCategory: "unique_nonce_candidate",
    };
  }

  if (top.score >= settings.probableThreshold) {
    return {
      status: "probable",
      canonicalItemId: top.itemId,
      confidence: top.score,
      candidates,
      shouldCreateItem: false,
      createdItemCategory: "unknown",
    };
  }

  return {
    status: "unresolved",
    canonicalItemId: null,
    confidence: top.score,
    candidates,
    shouldCreateItem: false,
    createdItemCategory: "unknown",
  };
}

export function metadataFromObservation(observation: Observation): BookMetadata {
  return observation.normalizedMetadata;
}
