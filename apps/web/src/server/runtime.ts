import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";
import {
  createDb,
  IdentityService,
  MemoryIdentityStore,
  PostgresIdentityStore,
  seedAdminSettings,
  AccountsRepository,
  AccountHistoryService,
  CatalogRepository,
  ScanScheduler,
  UpstreamObservationIngestor,
  LocalOwnershipEnricher,
  PitPandaOwnershipIngestor,
  runMigrations,
  type IdentityStore,
  type Database,
} from "@pitantir/db";
import { createItemDataProvider, PitPandaItemDataProvider } from "@pitantir/shared/item-data";
import { ItemSearchError } from "@pitantir/shared/item-data";
import { getPitPandaApiKey } from "./pitpanda-key-store";

/**
 * HMR-safe process singleton. Next.js re-evaluates this module on hot reload;
 * without globalThis, each reload opens another postgres pool until Postgres
 * returns "sorry, too many clients already".
 */
type WebDbGlobals = {
  databaseUrl?: string;
  database?: Database;
  sql?: postgres.Sql;
  dbReady?: Promise<void> | null;
  migratedForUrl?: string | null;
  identityStore?: IdentityStore | null;
  accountsRepo?: AccountsRepository | null;
  scanScheduler?: ScanScheduler | null;
  accountHistory?: AccountHistoryService | null;
  catalog?: CatalogRepository | null;
  localOwnershipEnricher?: LocalOwnershipEnricher | null;
};

const globalForDb = globalThis as typeof globalThis & {
  __pitantirWebDb?: WebDbGlobals;
};

function dbGlobals(): WebDbGlobals {
  if (!globalForDb.__pitantirWebDb) {
    globalForDb.__pitantirWebDb = {};
  }
  return globalForDb.__pitantirWebDb;
}

let identityService: IdentityService | null = null;
let ingestor: UpstreamObservationIngestor | null = null;
let ownershipIngestor: PitPandaOwnershipIngestor | null = null;

function migrationsFolder(): string {
  const candidates = [
    // Docker / monorepo cwd is usually the repo root.
    path.join(process.cwd(), "packages", "db", "migrations"),
    // Dev / Next source layout relative to this file.
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../packages/db/migrations",
    ),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

async function ensureDatabase(): Promise<{
  store: IdentityStore;
  accounts: AccountsRepository | null;
  scheduler: ScanScheduler | null;
  history: AccountHistoryService | null;
  catalogRepo: CatalogRepository | null;
}> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return {
      store: new MemoryIdentityStore(),
      accounts: null,
      scheduler: null,
      history: null,
      catalogRepo: null,
    };
  }

  const g = dbGlobals();

  // URL changed (rare) — drop the old pool so we don't leak it.
  if (g.databaseUrl && g.databaseUrl !== databaseUrl && g.sql) {
    await g.sql.end({ timeout: 1 }).catch(() => undefined);
    g.sql = undefined;
    g.database = undefined;
    g.dbReady = null;
    g.migratedForUrl = null;
    g.accountsRepo = null;
    g.scanScheduler = null;
    g.accountHistory = null;
    g.catalog = null;
    g.localOwnershipEnricher = null;
    g.identityStore = null;
  }

  if (!g.dbReady) {
    g.dbReady = (async () => {
      // Migrations open their own short-lived client. Only run once per URL
      // per process — live-status polls must not re-migrate every second.
      if (g.migratedForUrl !== databaseUrl) {
        await runMigrations(databaseUrl, migrationsFolder());
        g.migratedForUrl = databaseUrl;
      }

      if (!g.sql || !g.database) {
        const created = createDb(databaseUrl, {
          // Keep the web pool small; worker + Next HMR used to exhaust Postgres.
          max: 4,
        });
        g.sql = created.client;
        g.database = created.db;
        g.databaseUrl = databaseUrl;
      }

      await seedAdminSettings(g.database);
      g.identityStore = new PostgresIdentityStore(g.database);
      g.accountsRepo = new AccountsRepository(g.database);
      g.scanScheduler = new ScanScheduler(g.database);
      g.accountHistory = new AccountHistoryService(g.database, g.identityStore);
      g.catalog = new CatalogRepository(g.database);
      g.localOwnershipEnricher = new LocalOwnershipEnricher(g.database);
    })().catch((error) => {
      // Allow a later request to retry after "too many clients"/transient failures.
      g.dbReady = null;
      throw error;
    });
  }

  await g.dbReady;
  return {
    store: g.identityStore ?? new MemoryIdentityStore(),
    accounts: g.accountsRepo ?? null,
    scheduler: g.scanScheduler ?? null,
    history: g.accountHistory ?? null,
    catalogRepo: g.catalog ?? null,
  };
}

export async function getIdentityService(): Promise<IdentityService> {
  if (!identityService) {
    const { store } = await ensureDatabase();
    identityService = new IdentityService(store);
  }
  return identityService;
}

export async function getUpstreamIngestor(): Promise<UpstreamObservationIngestor> {
  if (!ingestor) {
    ingestor = new UpstreamObservationIngestor(await getIdentityService());
  }
  return ingestor;
}

export async function getAccountsRepository(): Promise<AccountsRepository | null> {
  const { accounts } = await ensureDatabase();
  return accounts;
}

export async function getScanScheduler(): Promise<ScanScheduler | null> {
  const { scheduler } = await ensureDatabase();
  return scheduler;
}

export async function getAccountHistoryService(): Promise<AccountHistoryService | null> {
  const { history } = await ensureDatabase();
  return history;
}

export async function getCatalogRepository(): Promise<CatalogRepository | null> {
  const { catalogRepo } = await ensureDatabase();
  return catalogRepo;
}

export function getItemDataProvider() {
  return createItemDataProvider({
    pitpandaApiKey: getPitPandaApiKey(),
    providerId: process.env.ITEM_DATA_PROVIDER,
  });
}

/** PitPanda provider with item-detail (owners timeline) for account history. */
export function getAccountHistoryItemProvider(): PitPandaItemDataProvider {
  const apiKey = getPitPandaApiKey();
  if (!apiKey) {
    throw new ItemSearchError(
      "configuration_error",
      "Search is not configured on the server.",
    );
  }
  return new PitPandaItemDataProvider({ apiKey });
}

export async function getLocalOwnershipEnricher(): Promise<LocalOwnershipEnricher | null> {
  await ensureDatabase();
  return dbGlobals().localOwnershipEnricher ?? null;
}

export async function getPitPandaOwnershipIngestor(): Promise<PitPandaOwnershipIngestor | null> {
  const { store, accounts } = await ensureDatabase();
  if (!accounts) return null;
  if (!ownershipIngestor) {
    ownershipIngestor = new PitPandaOwnershipIngestor(store, {
      ensureShadowOwner: async (input) => {
        const account = await accounts.ensureShadowOwner(input);
        return {
          id: account.id,
          mcUsername: account.mcUsername,
          mcUuid: account.mcUuid ?? input.mcUuid,
        };
      },
    });
  }
  return ownershipIngestor;
}

export function isUsingPostgres(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getDatabase(): Database | null {
  return dbGlobals().database ?? null;
}
