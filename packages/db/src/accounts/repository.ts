import { and, asc, eq, isNull, lte } from "drizzle-orm";
import type { Database } from "../client.js";
import { accounts, type AccountRow } from "../schema/accounts.js";
import { newId, now } from "../identity/store.js";
import { normalizeUuid } from "@pitantir/shared";

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
  notes?: string | null;
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
    return row ? mapAccount(row) : null;
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

    const updated = {
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

    if (input.mcUuid !== undefined) {
      try {
        updated.mcUuid = normalizeOptionalUuid(input.mcUuid) ?? null;
      } catch {
        throw new Error("Invalid Minecraft UUID");
      }
    }

    if (!/^[A-Za-z0-9_]{3,16}$/.test(updated.mcUsername)) {
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
}
