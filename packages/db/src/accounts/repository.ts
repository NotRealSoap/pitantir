import { and, asc, eq, isNull, lte } from "drizzle-orm";
import type { Database } from "../client.js";
import { accounts, type AccountRow } from "../schema/accounts.js";
import { newId, now } from "../identity/store.js";
import { normalizeUuid } from "@pitantir/shared";
import { notesIndicate140er } from "./notes-labels.js";
import { HYPIXEL_140ER_INTERVAL_SECONDS } from "@pitantir/shared/inventory";
import { staggeredNextScanAts } from "./scan-stagger.js";

function normalizeOptionalUuid(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === "") return null;
  return normalizeUuid(value.trim());
}

export interface Account {
  id: string;
  mcUuid: string | null;
  mcUsername: string;
  displayName: string | null;
  enabled: boolean;
  /** On the Hypixel refresh roster (primary). Ownership contacts are false. */
  watchlisted: boolean;
  priority: number;
  scanIntervalSeconds: number;
  nextScanAt: Date;
  lastSuccessScanAt: Date | null;
  lastFailureScanAt: Date | null;
  lastHypixelOnline: boolean | null;
  lastHypixelOnlineAt: Date | null;
  lastPresenceSource: string | null;
  lastSessionGame: string | null;
  lastInventoryHash: string | null;
  lastInventoryChangedAt: Date | null;
  lastPitpalLobby: string | null;
  lastPitpalLocation: string | null;
  lastPitpalArmorType: string | null;
  lastPitpalKillstreak: number | null;
  lastPitpalSeenAt: Date | null;
  lastPitpalIsNicked: boolean | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateAccountInput {
  mcUsername: string;
  mcUuid?: string | null;
  displayName?: string | null;
  enabled?: boolean;
  watchlisted?: boolean;
  priority?: number;
  scanIntervalSeconds?: number;
  notes?: string | null;
}

export interface UpdateAccountInput {
  mcUsername?: string;
  mcUuid?: string | null;
  displayName?: string | null;
  enabled?: boolean;
  watchlisted?: boolean;
  priority?: number;
  scanIntervalSeconds?: number;
  nextScanAt?: Date;
  notes?: string | null;
  lastHypixelOnline?: boolean | null;
  lastHypixelOnlineAt?: Date | null;
  lastPresenceSource?: string | null;
  lastSessionGame?: string | null;
  lastInventoryHash?: string | null;
  lastInventoryChangedAt?: Date | null;
  lastPitpalLobby?: string | null;
  lastPitpalLocation?: string | null;
  lastPitpalArmorType?: string | null;
  lastPitpalKillstreak?: number | null;
  lastPitpalSeenAt?: Date | null;
  lastPitpalIsNicked?: boolean | null;
}

function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    mcUuid: row.mcUuid,
    mcUsername: row.mcUsername,
    displayName: row.displayName,
    enabled: row.enabled,
    watchlisted: row.watchlisted,
    priority: row.priority,
    scanIntervalSeconds: row.scanIntervalSeconds,
    nextScanAt: row.nextScanAt,
    lastSuccessScanAt: row.lastSuccessScanAt,
    lastFailureScanAt: row.lastFailureScanAt,
    lastHypixelOnline: row.lastHypixelOnline ?? null,
    lastHypixelOnlineAt: row.lastHypixelOnlineAt ?? null,
    lastPresenceSource: row.lastPresenceSource ?? null,
    lastSessionGame: row.lastSessionGame ?? null,
    lastInventoryHash: row.lastInventoryHash ?? null,
    lastInventoryChangedAt: row.lastInventoryChangedAt ?? null,
    lastPitpalLobby: row.lastPitpalLobby ?? null,
    lastPitpalLocation: row.lastPitpalLocation ?? null,
    lastPitpalArmorType: row.lastPitpalArmorType ?? null,
    lastPitpalKillstreak: row.lastPitpalKillstreak ?? null,
    lastPitpalSeenAt: row.lastPitpalSeenAt ?? null,
    lastPitpalIsNicked: row.lastPitpalIsNicked ?? null,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

/** Public account DTO — never includes credentialsEncrypted. */
export type PublicAccount = Account;

export class AccountsRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<PublicAccount[]> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(isNull(accounts.deletedAt))
      .orderBy(asc(accounts.mcUsername));
    return rows.map(mapAccount);
  }

  async get(id: string): Promise<PublicAccount | null> {
    const rows = await this.db.select().from(accounts).where(eq(accounts.id, id));
    const row = rows[0];
    if (!row || row.deletedAt) {
      return null;
    }
    return mapAccount(row);
  }

  async getByUsername(username: string): Promise<PublicAccount | null> {
    const trimmed = username.trim();
    const rows = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.mcUsername, trimmed), isNull(accounts.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (row) return mapAccount(row);

    // Case-insensitive fallback (unique index is lower(mc_username)).
    const listed = await this.list();
    return listed.find((account) => account.mcUsername.toLowerCase() === trimmed.toLowerCase()) ?? null;
  }

  /**
   * Add to Hypixel watch list, or promote an existing ownership-contact row.
   * Avoids unique-username failures when the IGN was already collected from PitPanda.
   */
  async ensureOnWatchlist(input: {
    mcUsername: string;
    mcUuid?: string | null;
    displayName?: string | null;
  }): Promise<{ account: PublicAccount; created: boolean; promoted: boolean }> {
    const username = input.mcUsername.trim();
    const existing = await this.getByUsername(username);
    if (existing) {
      const patch: UpdateAccountInput = {};
      const wasOffWatchlist = !existing.watchlisted;
      if (!existing.watchlisted || !existing.enabled) {
        patch.watchlisted = true;
        patch.enabled = true;
      }
      // Apply Mojang-correct casing even when the row was already watchlisted.
      if (username !== existing.mcUsername) {
        patch.mcUsername = username;
      }
      if (input.mcUuid !== undefined && input.mcUuid !== existing.mcUuid) {
        patch.mcUuid = input.mcUuid;
      }
      if (input.displayName !== undefined) patch.displayName = input.displayName;

      if (Object.keys(patch).length === 0) {
        return { account: existing, created: false, promoted: false };
      }
      const account = await this.update(existing.id, patch);
      return { account, created: false, promoted: wasOffWatchlist };
    }

    const account = await this.create({
      mcUsername: username,
      mcUuid: input.mcUuid ?? null,
      displayName: input.displayName ?? null,
      watchlisted: true,
      enabled: true,
    });
    return { account, created: true, promoted: false };
  }

  async findByMcUuid(mcUuid: string): Promise<PublicAccount | null> {
    let normalized: string;
    try {
      normalized = normalizeUuid(mcUuid.trim());
    } catch {
      return null;
    }
    const rows = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.mcUuid, normalized), isNull(accounts.deletedAt)))
      .limit(1);
    const row = rows[0];
    return row ? mapAccount(row) : null;
  }

  /**
   * Find or create a disabled shadow account for PitPanda ownership imports.
   * Prefer UUID match, then username match (backfill UUID when missing).
   */
  async ensureShadowOwner(input: {
    mcUuid: string;
    mcUsername: string;
  }): Promise<PublicAccount> {
    const username = input.mcUsername.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      throw new Error("Invalid Minecraft username");
    }
    let normalized: string;
    try {
      normalized = normalizeUuid(input.mcUuid.trim());
    } catch {
      throw new Error("Invalid Minecraft UUID");
    }

    const byUuid = await this.findByMcUuid(normalized);
    if (byUuid) return byUuid;

    const byName = await this.getByUsername(username);
    if (byName) {
      if (!byName.mcUuid) {
        return this.update(byName.id, { mcUuid: normalized });
      }
      if (byName.mcUuid.toLowerCase() === normalized.toLowerCase()) {
        return byName;
      }
      // Username collision with a different UUID — create a unique shadow username.
      const suffix = normalized.replace(/-/g, "").slice(0, 4);
      const shadowName = `pp${suffix}${username}`.slice(0, 16);
      return this.create({
        mcUsername: shadowName,
        mcUuid: normalized,
        enabled: false,
        watchlisted: false,
        notes: `auto:pitpanda-owner (username collision with ${username})`,
      });
    }

    return this.create({
      mcUsername: username,
      mcUuid: normalized,
      enabled: false,
      watchlisted: false,
      notes: "auto:pitpanda-owner",
    });
  }

  async create(input: CreateAccountInput): Promise<PublicAccount> {
    const username = input.mcUsername.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      throw new Error("Invalid Minecraft username");
    }

    let mcUuid: string | null = null;
    try {
      mcUuid = normalizeOptionalUuid(input.mcUuid) ?? null;
    } catch {
      throw new Error("Invalid Minecraft UUID");
    }

    const timestamp = now();
    // Default creates land on the Hypixel watch list; shadows/cache pass watchlisted:false.
    const watchlisted = input.watchlisted ?? true;
    const enabled = input.enabled ?? true;
    const row = {
      id: newId(),
      mcUuid,
      mcUsername: username,
      displayName: input.displayName ?? null,
      enabled,
      watchlisted,
      priority: input.priority ?? 100,
      scanIntervalSeconds: input.scanIntervalSeconds ?? 3600,
      nextScanAt: timestamp,
      lastSuccessScanAt: null,
      lastFailureScanAt: null,
      credentialsEncrypted: null,
      notes: input.notes ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    await this.db.insert(accounts).values(row);
    return mapAccount(row);
  }

  async update(id: string, input: UpdateAccountInput): Promise<PublicAccount> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error("Account not found");
    }

    const updated: Record<string, unknown> = {
      mcUsername: input.mcUsername?.trim() ?? existing.mcUsername,
      mcUuid: existing.mcUuid,
      displayName: input.displayName === undefined ? existing.displayName : input.displayName,
      enabled: input.enabled ?? existing.enabled,
      watchlisted: input.watchlisted ?? existing.watchlisted,
      priority: input.priority ?? existing.priority,
      scanIntervalSeconds: input.scanIntervalSeconds ?? existing.scanIntervalSeconds,
      notes: input.notes === undefined ? existing.notes : input.notes,
      updatedAt: now(),
    };

    if (input.nextScanAt !== undefined) updated.nextScanAt = input.nextScanAt;

    if (input.mcUuid !== undefined) {
      try {
        updated.mcUuid = normalizeOptionalUuid(input.mcUuid) ?? null;
      } catch {
        throw new Error("Invalid Minecraft UUID");
      }
    }

    if (input.lastHypixelOnline !== undefined) updated.lastHypixelOnline = input.lastHypixelOnline;
    if (input.lastHypixelOnlineAt !== undefined) {
      updated.lastHypixelOnlineAt = input.lastHypixelOnlineAt;
    }
    if (input.lastPresenceSource !== undefined) updated.lastPresenceSource = input.lastPresenceSource;
    if (input.lastSessionGame !== undefined) updated.lastSessionGame = input.lastSessionGame;
    if (input.lastInventoryHash !== undefined) updated.lastInventoryHash = input.lastInventoryHash;
    if (input.lastInventoryChangedAt !== undefined) {
      updated.lastInventoryChangedAt = input.lastInventoryChangedAt;
    }
    if (input.lastPitpalLobby !== undefined) updated.lastPitpalLobby = input.lastPitpalLobby;
    if (input.lastPitpalLocation !== undefined) {
      updated.lastPitpalLocation = input.lastPitpalLocation;
    }
    if (input.lastPitpalArmorType !== undefined) {
      updated.lastPitpalArmorType = input.lastPitpalArmorType;
    }
    if (input.lastPitpalKillstreak !== undefined) {
      updated.lastPitpalKillstreak = input.lastPitpalKillstreak;
    }
    if (input.lastPitpalSeenAt !== undefined) updated.lastPitpalSeenAt = input.lastPitpalSeenAt;
    if (input.lastPitpalIsNicked !== undefined) {
      updated.lastPitpalIsNicked = input.lastPitpalIsNicked;
    }

    if (!/^[A-Za-z0-9_]{3,16}$/.test(String(updated.mcUsername))) {
      throw new Error("Invalid Minecraft username");
    }

    await this.db.update(accounts).set(updated).where(eq(accounts.id, id));
    return (await this.get(id))!;
  }

  async softDelete(id: string): Promise<void> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error("Account not found");
    }
    await this.db
      .update(accounts)
      .set({ deletedAt: now(), enabled: false, watchlisted: false, updatedAt: now() })
      .where(eq(accounts.id, id));
  }

  /** Due accounts on the Hypixel refresh roster (watchlisted + enabled). */
  async listEnabledForScan(asOf: Date = now()): Promise<PublicAccount[]> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(
        and(
          isNull(accounts.deletedAt),
          eq(accounts.watchlisted, true),
          eq(accounts.enabled, true),
          lte(accounts.nextScanAt, asOf),
        ),
      );
    return rows.map(mapAccount);
  }

  async listWatchlist(): Promise<PublicAccount[]> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(and(isNull(accounts.deletedAt), eq(accounts.watchlisted, true)))
      .orderBy(asc(accounts.mcUsername));
    return rows.map(mapAccount);
  }

  /** Auto-collected IGNs from ownership imports (not on the refresh roster). */
  async listOwnershipContacts(): Promise<PublicAccount[]> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(and(isNull(accounts.deletedAt), eq(accounts.watchlisted, false)))
      .orderBy(asc(accounts.mcUsername));
    return rows.map(mapAccount);
  }

  /**
   * Set scanIntervalSeconds for every watch-listed account and stagger nextScanAt
   * across the window so the worker does not burst-scan the whole roster.
   * 140er-labelled accounts are clamped to at least `slowIntervalSeconds` (default 30m).
   */
  async setWatchlistScanInterval(
    scanIntervalSeconds: number,
    options?: { slowIntervalSeconds?: number },
  ): Promise<number> {
    const seconds = Math.floor(scanIntervalSeconds);
    if (!Number.isFinite(seconds) || seconds < 30 || seconds > 86_400) {
      throw new Error("scanIntervalSeconds must be between 30 and 86400");
    }
    const slowFloor = Math.max(
      30,
      Math.floor(options?.slowIntervalSeconds ?? HYPIXEL_140ER_INTERVAL_SECONDS),
    );
    const timestamp = now();
    const watchlist = await this.listWatchlist();
    const nextAts = staggeredNextScanAts({
      count: watchlist.length,
      intervalSeconds: seconds,
      from: timestamp,
      mode: "rebalance",
    });

    for (let i = 0; i < watchlist.length; i += 1) {
      const account = watchlist[i]!;
      const interval = notesIndicate140er(account.notes)
        ? Math.max(seconds, slowFloor)
        : seconds;
      await this.db
        .update(accounts)
        .set({
          scanIntervalSeconds: interval,
          nextScanAt: nextAts[i]!,
          updatedAt: timestamp,
        })
        .where(eq(accounts.id, account.id));
    }
    return watchlist.length;
  }

  /**
   * Apply split pacing: 140ers at the slow floor, everyone else at `normalIntervalSeconds`.
   */
  async setSplitWatchlistScanIntervals(input: {
    normalIntervalSeconds: number;
    slowIntervalSeconds?: number;
  }): Promise<{ updated: number; normalCount: number; slowCount: number }> {
    const normalSeconds = Math.floor(input.normalIntervalSeconds);
    const slowSeconds = Math.max(
      30,
      Math.floor(input.slowIntervalSeconds ?? HYPIXEL_140ER_INTERVAL_SECONDS),
    );
    if (!Number.isFinite(normalSeconds) || normalSeconds < 30 || normalSeconds > 86_400) {
      throw new Error("normalIntervalSeconds must be between 30 and 86400");
    }

    const timestamp = now();
    const watchlist = await this.listWatchlist();
    const normal = watchlist.filter((row) => !notesIndicate140er(row.notes));
    const slow = watchlist.filter((row) => notesIndicate140er(row.notes));

    const normalAts = staggeredNextScanAts({
      count: normal.length,
      intervalSeconds: normalSeconds,
      from: timestamp,
      mode: "rebalance",
    });
    const slowAts = staggeredNextScanAts({
      count: slow.length,
      intervalSeconds: slowSeconds,
      from: timestamp,
      mode: "rebalance",
    });

    for (let i = 0; i < normal.length; i += 1) {
      await this.db
        .update(accounts)
        .set({
          scanIntervalSeconds: normalSeconds,
          nextScanAt: normalAts[i]!,
          updatedAt: timestamp,
        })
        .where(eq(accounts.id, normal[i]!.id));
    }
    for (let i = 0; i < slow.length; i += 1) {
      await this.db
        .update(accounts)
        .set({
          scanIntervalSeconds: slowSeconds,
          nextScanAt: slowAts[i]!,
          updatedAt: timestamp,
        })
        .where(eq(accounts.id, slow[i]!.id));
    }

    return {
      updated: watchlist.length,
      normalCount: normal.length,
      slowCount: slow.length,
    };
  }

  /** Re-spread nextScanAt for the current watch list without changing interval. */
  async rebalanceWatchlistSchedule(asOf: Date = now()): Promise<number> {
    const watchlist = await this.listWatchlist();
    if (watchlist.length === 0) return 0;
    const interval =
      Math.min(...watchlist.map((row) => row.scanIntervalSeconds)) || 3600;
    const nextAts = staggeredNextScanAts({
      count: watchlist.length,
      intervalSeconds: interval,
      from: asOf,
      mode: "rebalance",
    });
    for (let i = 0; i < watchlist.length; i += 1) {
      await this.db
        .update(accounts)
        .set({ nextScanAt: nextAts[i]!, updatedAt: asOf })
        .where(eq(accounts.id, watchlist[i]!.id));
    }
    return watchlist.length;
  }
}
