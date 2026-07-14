import { normalizeUuid } from "@pitantir/shared";
import type { IdentityStore } from "../identity/store.js";

/**
 * Minimal owner evidence from PitPanda.
 * `uuid` is the Minecraft player; `pitpandaEventId` is only PitPanda’s owners[] `_id`.
 */
export interface PitPandaOwnerEvidence {
  uuid: string;
  seenAt: string;
  /** PitPanda internal owners[] event `_id` — not a player/item UUID. */
  pitpandaEventId: string | null;
}

export interface OwnershipAccountRef {
  id: string;
  mcUsername: string;
  mcUuid: string;
}

export interface OwnershipAccountResolver {
  ensureShadowOwner(input: {
    mcUuid: string;
    mcUsername: string;
  }): Promise<OwnershipAccountRef>;
}

export interface PitPandaOwnershipIngestInput {
  canonicalItemId: string;
  pitpandaItemId: string | null;
  owners: PitPandaOwnerEvidence[];
  /** uuid (dashed) → username */
  usernameByUuid: Map<string, string>;
  lastSeenAt?: string | null;
  currentOwnerUuid?: string | null;
}

export interface PitPandaOwnershipIngestResult {
  periodsCreated: number;
  eventsCreated: number;
  accountsLinked: number;
  skippedOwnersWithoutUsername: number;
}

/**
 * Persist PitPanda `owners[{uuid,time}]` as import location periods/events.
 *
 * - Ownership identity is player `uuid` (+ time); owners[] `_id` is only for idempotency
 * - PitPanda item `_id` is stored as external_ref fetch key — not a Minecraft UUID
 * - Does not invent transfer times beyond consecutive owner sightings
 * - Uses certainty=uncertain and start_reason=import (never confirmed scan presence)
 * - Idempotent via import_presence event keys
 * - Does not call LocationEngine / Hypixel scan apply path
 */
export class PitPandaOwnershipIngestor {
  constructor(
    private readonly store: IdentityStore,
    private readonly accounts: OwnershipAccountResolver,
  ) {}

  async ingest(input: PitPandaOwnershipIngestInput): Promise<PitPandaOwnershipIngestResult> {
    const owners = [...input.owners].sort((a, b) => a.seenAt.localeCompare(b.seenAt));
    if (owners.length === 0) {
      return {
        periodsCreated: 0,
        eventsCreated: 0,
        accountsLinked: 0,
        skippedOwnersWithoutUsername: 0,
      };
    }

    if (input.pitpandaItemId) {
      try {
        // Mongo doc id is a PitPanda fetch key / external handle — not preferred game identity.
        await this.store.addIdentifier({
          itemId: input.canonicalItemId,
          kind: "external_ref",
          source: "pitpanda",
          value: input.pitpandaItemId,
          confidence: "medium",
          isPreferred: false,
        });
      } catch {
        // External ref may already belong to another item — keep going with owners.
      }
    }

    let periodsCreated = 0;
    let eventsCreated = 0;
    let accountsLinked = 0;
    let skippedOwnersWithoutUsername = 0;

    const resolvedOwners: Array<{
      owner: PitPandaOwnerEvidence;
      account: OwnershipAccountRef;
    }> = [];

    for (const owner of owners) {
      let uuid: string;
      try {
        uuid = normalizeUuid(owner.uuid);
      } catch {
        skippedOwnersWithoutUsername += 1;
        continue;
      }
      const username =
        input.usernameByUuid.get(uuid) ?? input.usernameByUuid.get(uuid.toLowerCase());
      if (!username) {
        skippedOwnersWithoutUsername += 1;
        continue;
      }
      const account = await this.accounts.ensureShadowOwner({
        mcUuid: uuid,
        mcUsername: username,
      });
      accountsLinked += 1;
      resolvedOwners.push({
        owner: { ...owner, uuid },
        account: {
          id: account.id,
          mcUsername: account.mcUsername,
          mcUuid: account.mcUuid,
        },
      });
    }

    const currentOwnerUuid = input.currentOwnerUuid
      ? safeNormalize(input.currentOwnerUuid)
      : null;
    const lastSeenAt = input.lastSeenAt ? new Date(input.lastSeenAt) : null;

    for (let index = 0; index < resolvedOwners.length; index += 1) {
      const current = resolvedOwners[index]!;
      const next = resolvedOwners[index + 1];
      const startedAt = new Date(current.owner.seenAt);
      if (Number.isNaN(startedAt.getTime())) continue;

      let endedAt: Date | null = null;
      let endReason: "corrected" | null = null;
      if (next) {
        endedAt = new Date(next.owner.seenAt);
        if (Number.isNaN(endedAt.getTime())) continue;
        endReason = "corrected";
      } else if (
        currentOwnerUuid &&
        current.account.mcUuid.toLowerCase() === currentOwnerUuid.toLowerCase()
      ) {
        endedAt = null;
        endReason = null;
      } else if (lastSeenAt && !Number.isNaN(lastSeenAt.getTime()) && lastSeenAt > startedAt) {
        endedAt = lastSeenAt;
        endReason = "corrected";
      }

      // Prefer PitPanda event `_id` for dedupe when present; fall back to player uuid + time.
      const ownerKey =
        current.owner.pitpandaEventId ?? `${current.owner.uuid}:${current.owner.seenAt}`;
      const idempotencyKey = `pp:import_presence:${input.canonicalItemId}:${ownerKey}`;

      const eventResult = await this.store.createLocationEvent({
        itemId: input.canonicalItemId,
        eventType: "import_presence",
        fromAccountId: index > 0 ? resolvedOwners[index - 1]!.account.id : null,
        toAccountId: current.account.id,
        eventTime: startedAt,
        certainty: "uncertain",
        scanId: null,
        observationId: null,
        periodId: null,
        idempotencyKey,
        payload: {
          source: "pitpanda",
          pitpandaItemId: input.pitpandaItemId,
          pitpandaEventId: current.owner.pitpandaEventId,
          ownerUuid: current.owner.uuid,
          ownerUsername: current.account.mcUsername,
        },
      });

      if (!eventResult.created) {
        continue;
      }
      eventsCreated += 1;

      const existing = await this.store.listLocationPeriodsForItem(input.canonicalItemId);
      const openConfirmedElsewhere = existing.some(
        (period) =>
          period.endedAt === null &&
          !period.isUnknownGap &&
          period.supersededAt === null &&
          period.certainty === "confirmed" &&
          period.accountId !== null &&
          period.accountId !== current.account.id &&
          period.startReason !== "import",
      );

      await this.store.createLocationPeriod({
        itemId: input.canonicalItemId,
        accountId: current.account.id,
        startedAt,
        endedAt,
        startReason: "import",
        endReason,
        certainty: "uncertain",
        isUnknownGap: false,
        openingObservationId: null,
        closingObservationContextScanId: null,
        notes: [
          "pitpanda-owner-import",
          input.pitpandaItemId ? `ppItem=${input.pitpandaItemId}` : null,
          current.owner.pitpandaEventId ? `ppEvent=${current.owner.pitpandaEventId}` : null,
          `ownerUuid=${current.owner.uuid}`,
          openConfirmedElsewhere ? "open-confirmed-scan-elsewhere" : null,
        ]
          .filter(Boolean)
          .join("; "),
      });
      periodsCreated += 1;
    }

    return {
      periodsCreated,
      eventsCreated,
      accountsLinked,
      skippedOwnersWithoutUsername,
    };
  }
}

function safeNormalize(value: string): string | null {
  try {
    return normalizeUuid(value);
  } catch {
    return null;
  }
}
