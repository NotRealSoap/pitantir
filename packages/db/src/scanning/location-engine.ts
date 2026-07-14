import type {
  ItemLocationEvent,
  ItemLocationPeriod,
  LocationEventType,
  Observation,
  PeriodCertainty,
} from "@pitantir/shared/identity";
import type { IdentityStore } from "../identity/store.js";
import type { Scan } from "./scans-repository.js";

const PARTICIPATING_RESOLUTIONS = new Set(["resolved", "manually_resolved", "probable"]);

export interface LocationEngineResult {
  eventsCreated: number;
  openedPeriods: number;
  closedPeriods: number;
}

/**
 * Location engine (T25–T28): presence open/close, confirmed/uncertain moves,
 * idempotent events, and contradiction marking per SCANNING_RULES.md §6.
 */
export class LocationEngine {
  constructor(private readonly store: IdentityStore) {}

  /**
   * Apply location updates after observations for a successful scan are resolved.
   * `previousOpenItemIds` must be captured BEFORE auto-resolve opens new periods.
   */
  async applyAccountScan(input: {
    scan: Scan;
    previousOpenItemIds: Set<string>;
    observations: Observation[];
  }): Promise<LocationEngineResult> {
    const { scan, previousOpenItemIds, observations } = input;
    if (scan.status !== "success" || !scan.observedAt) {
      return { eventsCreated: 0, openedPeriods: 0, closedPeriods: 0 };
    }

    let eventsCreated = 0;
    let openedPeriods = 0;
    let closedPeriods = 0;

    const curr = new Map<string, Observation>();
    for (const observation of observations) {
      if (
        !PARTICIPATING_RESOLUTIONS.has(observation.resolutionStatus) ||
        !observation.canonicalItemId
      ) {
        continue;
      }
      curr.set(observation.canonicalItemId, observation);
    }

    for (const [itemId, observation] of curr) {
      const result = await this.applyResolvedObservation({
        itemId,
        observation,
        scanId: scan.id,
      });
      eventsCreated += result.eventsCreated;
      openedPeriods += result.openedPeriods;
      closedPeriods += result.closedPeriods;
    }

    for (const itemId of previousOpenItemIds) {
      if (curr.has(itemId)) continue;
      const result = await this.applyDisappearance({
        itemId,
        accountId: scan.accountId,
        at: scan.observedAt,
        scanId: scan.id,
      });
      eventsCreated += result.eventsCreated;
      openedPeriods += result.openedPeriods;
      closedPeriods += result.closedPeriods;
    }

    return { eventsCreated, openedPeriods, closedPeriods };
  }

  async applyResolvedObservation(input: {
    itemId: string;
    observation: Observation;
    scanId: string;
  }): Promise<LocationEngineResult> {
    const { itemId, observation, scanId } = input;
    const accountId = observation.accountId;
    const at = observation.observedAt;
    let eventsCreated = 0;
    let openedPeriods = 0;
    let closedPeriods = 0;

    const periods = await this.store.listLocationPeriodsForItem(itemId);
    const openPresence = periods.filter(
      (period) => period.endedAt === null && !period.isUnknownGap && period.supersededAt === null,
    );
    const openOnAccount = openPresence.find((period) => period.accountId === accountId);
    const openElsewhere = openPresence.filter((period) => period.accountId !== accountId);
    const openGap = periods.find(
      (period) =>
        period.endedAt === null && period.isUnknownGap && period.supersededAt === null,
    );

    if (openGap) {
      await this.store.updateLocationPeriod(openGap.id, {
        endedAt: at,
        endReason: "unknown_gap",
        closingObservationContextScanId: scanId,
      });
      closedPeriods += 1;
    }

    if (openOnAccount) {
      const seen = await this.emit({
        itemId,
        eventType: "seen",
        fromAccountId: null,
        toAccountId: accountId,
        eventTime: at,
        certainty: openOnAccount.certainty,
        scanId,
        observationId: observation.id,
        periodId: openOnAccount.id,
        idempotencyKey: `loc:${itemId}:seen:${scanId}:${observation.id}`,
        payload: {},
      });
      if (seen.created) eventsCreated += 1;
      return { eventsCreated, openedPeriods, closedPeriods };
    }

    const cloneFamily = await this.isCloneFamilyItem(itemId);
    if (openElsewhere.length > 0) {
      for (const other of openElsewhere) {
        await this.store.updateLocationPeriod(other.id, { certainty: "uncertain" });
      }
      const period = await this.store.createLocationPeriod({
        itemId,
        accountId,
        startedAt: at,
        endedAt: null,
        startReason: "observed",
        endReason: null,
        certainty: "uncertain",
        isUnknownGap: false,
        openingObservationId: observation.id,
        closingObservationContextScanId: null,
        notes: cloneFamily
          ? "Opened while presence exists elsewhere (clone family — uncertain)"
          : "Opened while presence exists elsewhere (uncertain / contradiction)",
      });
      openedPeriods += 1;

      const uncertain = await this.emit({
        itemId,
        eventType: "move_uncertain",
        fromAccountId: openElsewhere[0]?.accountId ?? null,
        toAccountId: accountId,
        eventTime: at,
        certainty: "uncertain",
        scanId,
        observationId: observation.id,
        periodId: period.id,
        idempotencyKey: `loc:${itemId}:move_uncertain:${scanId}:${observation.id}`,
        payload: {
          openElsewhere: openElsewhere.map((period) => period.accountId),
          cloneFamily,
        },
      });
      if (uncertain.created) eventsCreated += 1;

      if (!cloneFamily) {
        for (const other of openElsewhere) {
          await this.store.updateLocationPeriod(other.id, { certainty: "contradicted" });
        }
        await this.store.updateLocationPeriod(period.id, { certainty: "contradicted" });
        const contradiction = await this.emit({
          itemId,
          eventType: "contradiction",
          fromAccountId: openElsewhere[0]?.accountId ?? null,
          toAccountId: accountId,
          eventTime: at,
          certainty: "contradicted",
          scanId,
          observationId: observation.id,
          periodId: period.id,
          idempotencyKey: `loc:${itemId}:contradiction:${scanId}:${observation.id}`,
          payload: {
            openElsewhere: openElsewhere.map((period) => period.accountId),
          },
        });
        if (contradiction.created) eventsCreated += 1;
      }

      return { eventsCreated, openedPeriods, closedPeriods };
    }

    const priorDisappearance = periods
      .filter(
        (period) =>
          !period.isUnknownGap &&
          period.endedAt !== null &&
          period.endReason === "disappeared" &&
          period.accountId !== null,
      )
      .sort((a, b) => (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0))[0];

    const period = await this.store.createLocationPeriod({
      itemId,
      accountId,
      startedAt: at,
      endedAt: null,
      startReason: priorDisappearance ? "inferred_move" : "observed",
      endReason: null,
      certainty: "confirmed",
      isUnknownGap: false,
      openingObservationId: observation.id,
      closingObservationContextScanId: null,
      notes: null,
    });
    openedPeriods += 1;

    const seen = await this.emit({
      itemId,
      eventType: "seen",
      fromAccountId: null,
      toAccountId: accountId,
      eventTime: at,
      certainty: "confirmed",
      scanId,
      observationId: observation.id,
      periodId: period.id,
      idempotencyKey: `loc:${itemId}:seen:${scanId}:${observation.id}`,
      payload: {},
    });
    if (seen.created) eventsCreated += 1;

    if (priorDisappearance?.accountId && !cloneFamily) {
      const move = await this.emit({
        itemId,
        eventType: "move_confirmed",
        fromAccountId: priorDisappearance.accountId,
        toAccountId: accountId,
        eventTime: at,
        certainty: "confirmed",
        scanId,
        observationId: observation.id,
        periodId: period.id,
        idempotencyKey: `loc:${itemId}:move_confirmed:${priorDisappearance.id}:${scanId}`,
        payload: {
          fromPeriodId: priorDisappearance.id,
          toPeriodId: period.id,
        },
      });
      if (move.created) eventsCreated += 1;
    }

    return { eventsCreated, openedPeriods, closedPeriods };
  }

  async applyDisappearance(input: {
    itemId: string;
    accountId: string;
    at: Date;
    scanId: string;
  }): Promise<LocationEngineResult> {
    const { itemId, accountId, at, scanId } = input;
    let eventsCreated = 0;
    let openedPeriods = 0;
    let closedPeriods = 0;

    const periods = await this.store.listLocationPeriodsForItem(itemId);
    const openOnAccount = periods.find(
      (period) =>
        period.accountId === accountId &&
        period.endedAt === null &&
        !period.isUnknownGap &&
        period.supersededAt === null,
    );
    if (!openOnAccount) {
      return { eventsCreated, openedPeriods, closedPeriods };
    }

    await this.store.updateLocationPeriod(openOnAccount.id, {
      endedAt: at,
      endReason: "disappeared",
      closingObservationContextScanId: scanId,
    });
    closedPeriods += 1;

    const disappeared = await this.emit({
      itemId,
      eventType: "disappeared",
      fromAccountId: accountId,
      toAccountId: null,
      eventTime: at,
      certainty: openOnAccount.certainty,
      scanId,
      observationId: null,
      periodId: openOnAccount.id,
      idempotencyKey: `loc:${itemId}:disappeared:${scanId}`,
      payload: {},
    });
    if (disappeared.created) eventsCreated += 1;

    const openElsewhere = periods.filter(
      (period) =>
        period.accountId !== accountId &&
        period.accountId !== null &&
        period.endedAt === null &&
        !period.isUnknownGap &&
        period.supersededAt === null,
    );

    if (openElsewhere.length === 1 && openElsewhere[0] && !(await this.isCloneFamilyItem(itemId))) {
      const dest = openElsewhere[0];
      await this.store.updateLocationPeriod(dest.id, { certainty: "confirmed" });
      const move = await this.emit({
        itemId,
        eventType: "move_confirmed",
        fromAccountId: accountId,
        toAccountId: dest.accountId,
        eventTime: at,
        certainty: "confirmed",
        scanId,
        observationId: null,
        periodId: dest.id,
        idempotencyKey: `loc:${itemId}:move_confirmed:${openOnAccount.id}:${dest.id}:${scanId}`,
        payload: { fromPeriodId: openOnAccount.id, toPeriodId: dest.id },
      });
      if (move.created) eventsCreated += 1;
      return { eventsCreated, openedPeriods, closedPeriods };
    }

    const existingGap = periods.find(
      (period) =>
        period.isUnknownGap && period.endedAt === null && period.supersededAt === null,
    );
    if (!existingGap) {
      const gap = await this.store.createLocationPeriod({
        itemId,
        accountId: null,
        startedAt: at,
        endedAt: null,
        startReason: "observed",
        endReason: null,
        certainty: "uncertain",
        isUnknownGap: true,
        openingObservationId: null,
        closingObservationContextScanId: null,
        notes: "Unknown location after successful scan absence",
      });
      openedPeriods += 1;
      const unknown = await this.emit({
        itemId,
        eventType: "unknown_started",
        fromAccountId: accountId,
        toAccountId: null,
        eventTime: at,
        certainty: "uncertain",
        scanId,
        observationId: null,
        periodId: gap.id,
        idempotencyKey: `loc:${itemId}:unknown_started:${scanId}`,
        payload: {},
      });
      if (unknown.created) eventsCreated += 1;
    }

    return { eventsCreated, openedPeriods, closedPeriods };
  }

  private async isCloneFamilyItem(itemId: string): Promise<boolean> {
    const item = await this.store.getCanonicalItem(itemId);
    if (!item) return false;
    if (item.category === "duplicate_nonce") return true;
    if (!item.primaryNonce) return false;
    const matches = await this.store.listIdentifiersByKindValue("nonce", item.primaryNonce);
    const activeItemIds = new Set<string>();
    for (const identifier of matches) {
      const other = await this.store.getCanonicalItem(identifier.itemId);
      if (other && other.status === "active" && !other.deletedAt) {
        activeItemIds.add(other.id);
      }
    }
    return activeItemIds.size > 1;
  }

  private async emit(
    event: Omit<ItemLocationEvent, "id" | "createdAt">,
  ): Promise<{ event: ItemLocationEvent; created: boolean }> {
    return this.store.createLocationEvent(event);
  }
}

export function locationEventLabel(eventType: LocationEventType): string {
  switch (eventType) {
    case "seen":
      return "Seen";
    case "disappeared":
      return "Disappeared";
    case "unknown_started":
      return "Unknown location";
    case "move_confirmed":
      return "Moved (confirmed)";
    case "move_uncertain":
      return "Moved (uncertain)";
    case "contradiction":
      return "Contradiction";
    case "import_presence":
      return "Import presence";
    case "manual_correction":
      return "Manual correction";
    default:
      return eventType;
  }
}

export function certaintyLabel(certainty: PeriodCertainty): string {
  return certainty;
}

/** Helper: open periods on an account right now (for Prev snapshot). */
export async function snapshotOpenPresenceItemIds(
  store: IdentityStore,
  accountId: string,
): Promise<Set<string>> {
  const open = await store.listOpenPresenceOnAccount(accountId);
  return new Set(open.map((period) => period.itemId));
}

export type { ItemLocationPeriod };
