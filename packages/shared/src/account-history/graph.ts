import type {
  AccountHistoryGraphEdge,
  AccountHistoryGraphNode,
  AccountHistoryItem,
} from "./schemas.js";

export interface BuildOwnershipGraphInput {
  searchedUsername: string | null;
  searchedUuid: string | null;
  items: AccountHistoryItem[];
  /** When set, only include this item and its related accounts. */
  selectedItemKey?: string | null;
  minCertainty?: "any" | "confirmed" | "uncertain";
}

function certaintyAllowed(
  certainty: string,
  min: "any" | "confirmed" | "uncertain",
): boolean {
  if (min === "any") return true;
  if (min === "confirmed") return certainty === "confirmed";
  return certainty === "confirmed" || certainty === "uncertain" || certainty === "pitpanda";
}

function accountNodeId(username: string | null, uuid: string | null, accountId: string | null): string {
  if (uuid) return `account:uuid:${uuid.toLowerCase()}`;
  if (username) return `account:name:${username.toLowerCase()}`;
  if (accountId) return `account:id:${accountId}`;
  return "account:unknown";
}

function itemNodeId(item: AccountHistoryItem): string {
  // Prefer game identity (canonical / nonce / item UUID) over PitPanda Mongo doc id.
  if (item.canonicalItemId) return `item:id:${item.canonicalItemId}`;
  if (item.nonce) return `item:nonce:${item.nonce}`;
  if (item.itemUuid) return `item:uuid:${item.itemUuid.toLowerCase()}`;
  if (item.pitpandaItemId) return `item:pp:${item.pitpandaItemId}`;
  return `item:key:${item.key}`;
}

/**
 * Build a bipartite ownership graph: accounts ↔ items.
 * Accounts keyed by Minecraft UUID; items by canonical / nonce / item UUID (PitPanda `_id` last).
 */
export function buildOwnershipGraph(input: BuildOwnershipGraphInput): {
  nodes: AccountHistoryGraphNode[];
  links: AccountHistoryGraphEdge[];
} {
  const minCertainty = input.minCertainty ?? "any";
  let items = input.items;
  if (input.selectedItemKey) {
    const key = input.selectedItemKey;
    items = items.filter(
      (item) =>
        item.key === key ||
        item.canonicalItemId === key ||
        item.nonce === key ||
        item.providerItemKey === key ||
        item.pitpandaItemId === key,
    );
  }

  const nodes = new Map<string, AccountHistoryGraphNode>();
  const links = new Map<string, AccountHistoryGraphEdge>();

  const focusId = accountNodeId(input.searchedUsername, input.searchedUuid, null);
  nodes.set(focusId, {
    id: focusId,
    kind: "account",
    label: input.searchedUsername ?? input.searchedUuid ?? "Searched account",
    emphasized: true,
    username: input.searchedUsername,
    uuid: input.searchedUuid,
  });

  for (const item of items) {
    const iId = itemNodeId(item);
    if (!nodes.has(iId)) {
      nodes.set(iId, {
        id: iId,
        kind: "item",
        label: item.title ?? item.nonce ?? iId,
        nonce: item.nonce,
        itemType: item.kind ?? item.title,
        firstSeenAt:
          item.pitpandaOwners[0]?.seenAt ??
          item.ownershipPeriods.at(-1)?.startedAt ??
          item.lastSeenAt,
        lastSeenAt: item.lastSeenAt,
        source: item.source,
      });
    }

    for (const owner of item.pitpandaOwners) {
      if (!certaintyAllowed("pitpanda", minCertainty)) continue;
      const aId = accountNodeId(owner.username, owner.uuid, null);
      if (!nodes.has(aId)) {
        nodes.set(aId, {
          id: aId,
          kind: "account",
          label: owner.username ?? owner.uuid.slice(0, 8),
          username: owner.username,
          uuid: owner.uuid,
          emphasized: aId === focusId,
          firstSeenAt: owner.seenAt,
          lastSeenAt: owner.seenAt,
          certainty: "pitpanda",
          source: "pitpanda",
        });
      } else {
        const existing = nodes.get(aId)!;
        existing.firstSeenAt = minIso(existing.firstSeenAt ?? null, owner.seenAt);
        existing.lastSeenAt = maxIso(existing.lastSeenAt ?? null, owner.seenAt);
      }

      const edgeId = `edge:${aId}->${iId}:pp:${owner.uuid}:${owner.pitpandaEventId ?? owner.seenAt}`;
      if (!links.has(edgeId)) {
        links.set(edgeId, {
          id: edgeId,
          source: aId,
          target: iId,
          label: "pitpanda owner",
          firstSeenAt: owner.seenAt,
          lastSeenAt: owner.seenAt,
          certainty: "pitpanda",
          observationSource: "pitpanda",
        });
      }
    }

    // Current attribution edge when no owners timeline yet
    if (item.pitpandaOwners.length === 0) {
      const currentOwnerId = accountNodeId(
        item.currentOwnerUsername ?? input.searchedUsername,
        item.currentOwnerUuid ?? input.searchedUuid,
        null,
      );
      if (!nodes.has(currentOwnerId)) {
        nodes.set(currentOwnerId, {
          id: currentOwnerId,
          kind: "account",
          label: item.currentOwnerUsername ?? item.currentOwnerUuid ?? "Owner",
          username: item.currentOwnerUsername,
          uuid: item.currentOwnerUuid,
          emphasized: currentOwnerId === focusId,
        });
      }
      const currentEdgeId = `edge:${currentOwnerId}->${iId}:current`;
      if (!links.has(currentEdgeId)) {
        links.set(currentEdgeId, {
          id: currentEdgeId,
          source: currentOwnerId,
          target: iId,
          label: "indexed current",
          lastSeenAt: item.lastSeenAt,
          certainty: "indexed",
          observationSource: item.source,
        });
      }
    }

    for (const period of item.ownershipPeriods) {
      if (period.isUnknownGap) continue;
      if (!certaintyAllowed(period.certainty, minCertainty)) continue;
      const aId = accountNodeId(period.accountUsername, period.accountUuid, period.accountId);
      if (aId === "account:unknown") continue;
      if (!nodes.has(aId)) {
        nodes.set(aId, {
          id: aId,
          kind: "account",
          label: period.accountUsername ?? period.accountUuid ?? period.accountId ?? "Account",
          username: period.accountUsername,
          uuid: period.accountUuid,
          emphasized: aId === focusId,
          firstSeenAt: period.startedAt,
          lastSeenAt: period.endedAt,
          certainty: period.certainty,
          source: "local_database",
        });
      } else {
        const existing = nodes.get(aId)!;
        existing.firstSeenAt = minIso(existing.firstSeenAt ?? null, period.startedAt);
        existing.lastSeenAt = maxIso(existing.lastSeenAt ?? null, period.endedAt);
      }

      const edgeId = `edge:${aId}->${iId}:local:${period.periodId}`;
      if (!links.has(edgeId)) {
        links.set(edgeId, {
          id: edgeId,
          source: aId,
          target: iId,
          label: period.certainty,
          firstSeenAt: period.startedAt,
          lastSeenAt: period.endedAt,
          certainty: period.certainty,
          observationSource: "local_database",
        });
      }
    }
  }

  return { nodes: [...nodes.values()], links: [...links.values()] };
}

function minIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** Chronological ownership events for a single item (or all items). */
export function buildItemTimeline(
  items: AccountHistoryItem[],
  selectedItemKey?: string | null,
): AccountHistoryItem["ownershipEvents"] {
  let selected = items;
  if (selectedItemKey) {
    selected = items.filter(
      (item) =>
        item.key === selectedItemKey ||
        item.canonicalItemId === selectedItemKey ||
        item.nonce === selectedItemKey ||
        item.providerItemKey === selectedItemKey ||
        item.pitpandaItemId === selectedItemKey,
    );
  }

  const fromLocal = selected.flatMap((item) =>
    item.ownershipEvents.map((event) => ({
      ...event,
      // Scope by item so the same DB event id never collides across rows in the UI list.
      eventId: `${item.key}:${event.eventId}`,
    })),
  );
  const fromPitpanda = selected.flatMap((item) => {
    const owners = item.pitpandaOwners;
    return owners.map((owner, index) => {
      const prev = index > 0 ? owners[index - 1] : null;
      return {
        eventId: `pp:${item.key}:${owner.uuid}:${owner.pitpandaEventId ?? owner.seenAt}:${index}`,
        eventType: index === 0 ? "first_seen" : "owner_change",
        label: index === 0 ? "First seen (PitPanda)" : "Owner change (PitPanda)",
        eventTime: owner.seenAt,
        certainty: "pitpanda",
        fromAccountId: null,
        fromAccountUsername: prev?.username ?? null,
        toAccountId: null,
        toAccountUsername: owner.username,
      };
    });
  });

  const merged = [...fromLocal, ...fromPitpanda].sort((a, b) =>
    a.eventTime.localeCompare(b.eventTime),
  );

  // Deduplicate by eventId (duplicate occurrences across items or owners timelines).
  const seen = new Set<string>();
  const deduped: typeof merged = [];
  for (const event of merged) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    deduped.push(event);
  }
  return deduped;
}
