import { and, desc, eq, ilike, isNull, or, inArray } from "drizzle-orm";
import type {
  CanonicalItem,
  ItemIdentifier,
  ItemLocationEvent,
  ItemLocationPeriod,
  Observation,
} from "@pitantir/shared/identity";
import type { Database } from "../client.js";
import {
  canonicalItems,
  itemIdentifiers,
  itemLocationEvents,
  itemLocationPeriods,
  observations,
} from "../schema/identity.js";
import { accounts } from "../schema/accounts.js";
import { scans } from "../schema/scans.js";
import { ScansRepository, type PublicScanSummary } from "./scans-repository.js";
import { locationEventLabel } from "./location-engine.js";

export interface ItemListFilters {
  nonce?: string;
  category?: string;
  confidence?: string;
  /** known = open non-gap presence; unknown = no open presence or only gaps */
  location?: "known" | "unknown" | "any";
  q?: string;
  limit?: number;
}

export interface ItemListRow {
  id: string;
  displayName: string | null;
  primaryNonce: string | null;
  category: CanonicalItem["category"];
  identityConfidence: CanonicalItem["identityConfidence"];
  strictFingerprint: string | null;
  status: CanonicalItem["status"];
  currentAccountId: string | null;
  currentAccountUsername: string | null;
  locationKnown: boolean;
  updatedAt: Date;
}

export interface ItemDetail {
  item: CanonicalItem;
  identifiers: ItemIdentifier[];
  periods: Array<
    ItemLocationPeriod & {
      accountUsername: string | null;
    }
  >;
  events: Array<
    ItemLocationEvent & {
      fromAccountUsername: string | null;
      toAccountUsername: string | null;
      label: string;
    }
  >;
  observations: Observation[];
  currentLocation: {
    accountId: string;
    mcUsername: string | null;
    startedAt: Date;
    certainty: string;
  } | null;
}

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

export class CatalogRepository {
  private readonly scansRepo: ScansRepository;

  constructor(private readonly db: Database) {
    this.scansRepo = new ScansRepository(db);
  }

  async listItems(filters: ItemListFilters = {}): Promise<ItemListRow[]> {
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
    const conditions = [isNull(canonicalItems.deletedAt), eq(canonicalItems.status, "active")];

    if (filters.nonce) {
      conditions.push(ilike(canonicalItems.primaryNonce, `%${filters.nonce}%`));
    }
    if (filters.category) {
      conditions.push(eq(canonicalItems.category, filters.category as CanonicalItem["category"]));
    }
    if (filters.confidence) {
      conditions.push(
        eq(
          canonicalItems.identityConfidence,
          filters.confidence as CanonicalItem["identityConfidence"],
        ),
      );
    }
    if (filters.q) {
      const q = `%${filters.q}%`;
      conditions.push(
        or(
          ilike(canonicalItems.displayName, q),
          ilike(canonicalItems.primaryNonce, q),
          ilike(canonicalItems.strictFingerprint, q),
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(canonicalItems)
      .where(and(...conditions))
      .orderBy(desc(canonicalItems.updatedAt))
      .limit(limit);

    const results: ItemListRow[] = [];
    for (const row of rows) {
      const open = await this.db
        .select({
          accountId: itemLocationPeriods.accountId,
          username: accounts.mcUsername,
        })
        .from(itemLocationPeriods)
        .leftJoin(accounts, eq(accounts.id, itemLocationPeriods.accountId))
        .where(
          and(
            eq(itemLocationPeriods.itemId, row.id),
            isNull(itemLocationPeriods.endedAt),
            isNull(itemLocationPeriods.supersededAt),
            eq(itemLocationPeriods.isUnknownGap, false),
          ),
        )
        .limit(1);

      const current = open[0];
      const locationKnown = Boolean(current?.accountId);

      if (filters.location === "known" && !locationKnown) continue;
      if (filters.location === "unknown" && locationKnown) continue;

      results.push({
        id: row.id,
        displayName: row.displayName,
        primaryNonce: row.primaryNonce,
        category: row.category,
        identityConfidence: row.identityConfidence,
        strictFingerprint: row.strictFingerprint,
        status: row.status,
        currentAccountId: current?.accountId ?? null,
        currentAccountUsername: current?.username ?? null,
        locationKnown,
        updatedAt: row.updatedAt,
      });
    }

    return results;
  }

  async getItemDetail(itemId: string): Promise<ItemDetail | null> {
    const itemRows = await this.db
      .select()
      .from(canonicalItems)
      .where(eq(canonicalItems.id, itemId));
    const itemRow = itemRows[0];
    if (!itemRow || itemRow.deletedAt) {
      return null;
    }
    const item = mapItem(itemRow);

    const identifierRows = await this.db
      .select()
      .from(itemIdentifiers)
      .where(and(eq(itemIdentifiers.itemId, itemId), isNull(itemIdentifiers.invalidatedAt)));

    const identifiers: ItemIdentifier[] = identifierRows.map((row) => ({
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
    }));

    const periodRows = await this.db
      .select()
      .from(itemLocationPeriods)
      .where(
        and(eq(itemLocationPeriods.itemId, itemId), isNull(itemLocationPeriods.supersededAt)),
      )
      .orderBy(desc(itemLocationPeriods.startedAt));

    const accountIds = [
      ...new Set(
        periodRows
          .map((row) => row.accountId)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    const eventRows = await this.db
      .select()
      .from(itemLocationEvents)
      .where(eq(itemLocationEvents.itemId, itemId))
      .orderBy(desc(itemLocationEvents.eventTime));
    for (const row of eventRows) {
      if (row.fromAccountId) accountIds.push(row.fromAccountId);
      if (row.toAccountId) accountIds.push(row.toAccountId);
    }
    const uniqueAccountIds = [...new Set(accountIds)];
    const usernameById = new Map<string, string>();
    if (uniqueAccountIds.length > 0) {
      const accountRows = await this.db
        .select({ id: accounts.id, username: accounts.mcUsername })
        .from(accounts)
        .where(inArray(accounts.id, uniqueAccountIds));
      for (const row of accountRows) {
        usernameById.set(row.id, row.username);
      }
    }

    const periods: ItemDetail["periods"] = periodRows.map((row) => ({
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
      accountUsername: row.accountId ? (usernameById.get(row.accountId) ?? null) : null,
    }));

    const events: ItemDetail["events"] = eventRows.map((row) => ({
      id: row.id,
      itemId: row.itemId,
      eventType: row.eventType,
      fromAccountId: row.fromAccountId,
      toAccountId: row.toAccountId,
      eventTime: row.eventTime,
      certainty: row.certainty as ItemLocationEvent["certainty"],
      scanId: row.scanId,
      observationId: row.observationId,
      periodId: row.periodId,
      idempotencyKey: row.idempotencyKey,
      payload: (row.payload as Record<string, unknown>) ?? {},
      createdAt: row.createdAt,
      fromAccountUsername: row.fromAccountId
        ? (usernameById.get(row.fromAccountId) ?? null)
        : null,
      toAccountUsername: row.toAccountId ? (usernameById.get(row.toAccountId) ?? null) : null,
      label: locationEventLabel(row.eventType),
    }));

    const observationRows = await this.db
      .select()
      .from(observations)
      .where(eq(observations.canonicalItemId, itemId))
      .orderBy(desc(observations.observedAt));

    const obs: Observation[] = observationRows.map((row) => ({
      id: row.id,
      scanId: row.scanId,
      accountId: row.accountId,
      observedAt: row.observedAt,
      slotKey: row.slotKey,
      rawItem: row.rawItem as Record<string, unknown>,
      observedNonce: row.observedNonce,
      normalizedMetadata: row.normalizedMetadata as Observation["normalizedMetadata"],
      strictFingerprint: row.strictFingerprint,
      looseFingerprint: row.looseFingerprint,
      canonicalItemId: row.canonicalItemId,
      resolutionStatus: row.resolutionStatus,
      confidence: row.confidence === null ? null : Number(row.confidence),
      resolutionNote: row.resolutionNote,
      resolvedAt: row.resolvedAt,
      resolvedBy: row.resolvedBy as Observation["resolvedBy"],
      createdAt: row.createdAt,
    }));

    const open = periods.find((p) => !p.endedAt && !p.isUnknownGap && p.accountId);
    let currentLocation: ItemDetail["currentLocation"] = null;
    if (open?.accountId) {
      currentLocation = {
        accountId: open.accountId,
        mcUsername: open.accountUsername,
        startedAt: open.startedAt,
        certainty: open.certainty,
      };
    }

    return { item, identifiers, periods, events, observations: obs, currentLocation };
  }

  async listScans(limit = 100): Promise<PublicScanSummary[]> {
    const rows = await this.db
      .select()
      .from(scans)
      .orderBy(desc(scans.createdAt))
      .limit(Math.min(Math.max(limit, 1), 500));

    return rows.map((row) =>
      this.scansRepo.toPublicSummary({
        id: row.id,
        accountId: row.accountId,
        status: row.status,
        triggeredBy: row.triggeredBy,
        idempotencyKey: row.idempotencyKey,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        observedAt: row.observedAt,
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
        rawInventoryHash: row.rawInventoryHash,
        rawInventory: (row.rawInventory as Record<string, unknown> | null) ?? null,
        itemCount: row.itemCount,
        processingStatus: row.processingStatus,
        processedAt: row.processedAt,
        createdAt: row.createdAt,
      }),
    );
  }

  async listScansWithAccounts(limit = 100): Promise<
    Array<PublicScanSummary & { mcUsername: string | null }>
  > {
    const rows = await this.db
      .select({
        scan: scans,
        mcUsername: accounts.mcUsername,
      })
      .from(scans)
      .leftJoin(accounts, eq(accounts.id, scans.accountId))
      .orderBy(desc(scans.createdAt))
      .limit(Math.min(Math.max(limit, 1), 500));

    return rows.map(({ scan, mcUsername }) => ({
      ...this.scansRepo.toPublicSummary({
        id: scan.id,
        accountId: scan.accountId,
        status: scan.status,
        triggeredBy: scan.triggeredBy,
        idempotencyKey: scan.idempotencyKey,
        startedAt: scan.startedAt,
        finishedAt: scan.finishedAt,
        observedAt: scan.observedAt,
        errorCode: scan.errorCode,
        errorMessage: scan.errorMessage,
        rawInventoryHash: scan.rawInventoryHash,
        rawInventory: (scan.rawInventory as Record<string, unknown> | null) ?? null,
        itemCount: scan.itemCount,
        processingStatus: scan.processingStatus,
        processedAt: scan.processedAt,
        createdAt: scan.createdAt,
      }),
      mcUsername,
    }));
  }
}
