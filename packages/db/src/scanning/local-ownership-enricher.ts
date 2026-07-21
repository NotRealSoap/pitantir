import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../client.js";
import { accounts } from "../schema/accounts.js";
import { canonicalItems, itemLocationEvents, itemLocationPeriods } from "../schema/identity.js";
import { locationEventLabel } from "./location-engine.js";

export interface LocalOwnershipPeriodRow {
  periodId: string;
  itemId: string;
  accountId: string | null;
  accountUsername: string | null;
  accountUuid: string | null;
  startedAt: Date;
  endedAt: Date | null;
  certainty: string;
  isUnknownGap: boolean;
  startReason: string | null;
  endReason: string | null;
}

export interface LocalOwnershipEventRow {
  eventId: string;
  itemId: string;
  eventType: string;
  label: string;
  eventTime: Date;
  certainty: string;
  fromAccountId: string | null;
  fromAccountUsername: string | null;
  toAccountId: string | null;
  toAccountUsername: string | null;
}

export interface LocalOwnershipBundle {
  itemId: string;
  primaryNonce: string | null;
  displayName: string | null;
  periods: LocalOwnershipPeriodRow[];
  events: LocalOwnershipEventRow[];
}

/**
 * Batch-load local ownership periods/events for canonical items matched by nonce.
 */
export class LocalOwnershipEnricher {
  constructor(private readonly db: Database) {}

  async findCanonicalIdsByNonces(nonces: string[]): Promise<Map<string, string[]>> {
    const unique = [...new Set(nonces.filter((n) => n.trim().length > 0))];
    const out = new Map<string, string[]>();
    if (unique.length === 0) return out;

    const rows = await this.db
      .select({
        id: canonicalItems.id,
        primaryNonce: canonicalItems.primaryNonce,
      })
      .from(canonicalItems)
      .where(
        and(isNull(canonicalItems.deletedAt), inArray(canonicalItems.primaryNonce, unique)),
      );

    for (const row of rows) {
      if (!row.primaryNonce) continue;
      const list = out.get(row.primaryNonce) ?? [];
      list.push(row.id);
      out.set(row.primaryNonce, list);
    }
    return out;
  }

  async loadOwnershipBundles(itemIds: string[]): Promise<Map<string, LocalOwnershipBundle>> {
    const unique = [...new Set(itemIds)];
    const out = new Map<string, LocalOwnershipBundle>();
    if (unique.length === 0) return out;

    const itemRows = await this.db
      .select({
        id: canonicalItems.id,
        primaryNonce: canonicalItems.primaryNonce,
        displayName: canonicalItems.displayName,
      })
      .from(canonicalItems)
      .where(and(isNull(canonicalItems.deletedAt), inArray(canonicalItems.id, unique)));

    for (const row of itemRows) {
      out.set(row.id, {
        itemId: row.id,
        primaryNonce: row.primaryNonce,
        displayName: row.displayName,
        periods: [],
        events: [],
      });
    }

    const periodRows = await this.db
      .select()
      .from(itemLocationPeriods)
      .where(
        and(inArray(itemLocationPeriods.itemId, unique), isNull(itemLocationPeriods.supersededAt)),
      )
      .orderBy(desc(itemLocationPeriods.startedAt));

    const eventRows = await this.db
      .select()
      .from(itemLocationEvents)
      .where(inArray(itemLocationEvents.itemId, unique))
      .orderBy(desc(itemLocationEvents.eventTime));

    const accountIds = new Set<string>();
    for (const row of periodRows) {
      if (row.accountId) accountIds.add(row.accountId);
    }
    for (const row of eventRows) {
      if (row.fromAccountId) accountIds.add(row.fromAccountId);
      if (row.toAccountId) accountIds.add(row.toAccountId);
    }

    const usernameById = new Map<string, { username: string; uuid: string | null }>();
    if (accountIds.size > 0) {
      const accountRows = await this.db
        .select({
          id: accounts.id,
          username: accounts.mcUsername,
          uuid: accounts.mcUuid,
        })
        .from(accounts)
        .where(inArray(accounts.id, [...accountIds]));
      for (const row of accountRows) {
        usernameById.set(row.id, { username: row.username, uuid: row.uuid });
      }
    }

    for (const row of periodRows) {
      const bundle = out.get(row.itemId);
      if (!bundle) continue;
      const account = row.accountId ? usernameById.get(row.accountId) : null;
      bundle.periods.push({
        periodId: row.id,
        itemId: row.itemId,
        accountId: row.accountId,
        accountUsername: account?.username ?? null,
        accountUuid: account?.uuid ?? null,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        certainty: row.certainty,
        isUnknownGap: row.isUnknownGap,
        startReason: row.startReason,
        endReason: row.endReason,
      });
    }

    for (const row of eventRows) {
      const bundle = out.get(row.itemId);
      if (!bundle) continue;
      const from = row.fromAccountId ? usernameById.get(row.fromAccountId) : null;
      const to = row.toAccountId ? usernameById.get(row.toAccountId) : null;
      bundle.events.push({
        eventId: row.id,
        itemId: row.itemId,
        eventType: row.eventType,
        label: locationEventLabel(row.eventType),
        eventTime: row.eventTime,
        certainty: row.certainty,
        fromAccountId: row.fromAccountId,
        fromAccountUsername: from?.username ?? null,
        toAccountId: row.toAccountId,
        toAccountUsername: to?.username ?? null,
      });
    }

    return out;
  }

  async findUsernamesByUuids(uuids: string[]): Promise<Map<string, string>> {
    const normalized = [
      ...new Set(
        uuids
          .map((u) => u.replace(/-/g, "").toLowerCase())
          .filter((u) => /^[0-9a-f]{32}$/.test(u)),
      ),
    ];
    const out = new Map<string, string>();
    if (normalized.length === 0) return out;

    // Compare undashed forms in JS after fetch of known accounts (small table for MVP).
    const rows = await this.db
      .select({ username: accounts.mcUsername, uuid: accounts.mcUuid })
      .from(accounts)
      .where(and(isNull(accounts.deletedAt), eq(accounts.enabled, true)));

    const wanted = new Set(normalized);
    for (const row of rows) {
      if (!row.uuid) continue;
      const key = row.uuid.replace(/-/g, "").toLowerCase();
      if (wanted.has(key)) {
        const dashed = `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20)}`;
        out.set(dashed, row.username);
      }
    }
    return out;
  }
}
