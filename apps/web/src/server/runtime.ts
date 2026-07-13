import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDb,
  IdentityService,
  MemoryIdentityStore,
  PostgresIdentityStore,
  seedAdminSettings,
  AccountsRepository,
  ScanScheduler,
  UpstreamObservationIngestor,
  runMigrations,
  type IdentityStore,
} from "@pitantir/db";
import { createItemDataProvider } from "@pitantir/shared/item-data";
import { getPitPandaApiKey } from "./pitpanda-key-store";

let identityService: IdentityService | null = null;
let identityStore: IdentityStore | null = null;
let ingestor: UpstreamObservationIngestor | null = null;
let accountsRepo: AccountsRepository | null = null;
let scanScheduler: ScanScheduler | null = null;
let dbReady: Promise<void> | null = null;

function migrationsFolder(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../packages/db/migrations",
  );
}

async function ensureDatabase(): Promise<{
  store: IdentityStore;
  accounts: AccountsRepository | null;
  scheduler: ScanScheduler | null;
}> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return { store: new MemoryIdentityStore(), accounts: null, scheduler: null };
  }

  if (!dbReady) {
    dbReady = (async () => {
      await runMigrations(databaseUrl, migrationsFolder());
      const { db } = createDb(databaseUrl, { max: 10 });
      await seedAdminSettings(db);
      identityStore = new PostgresIdentityStore(db);
      accountsRepo = new AccountsRepository(db);
      scanScheduler = new ScanScheduler(db);
    })();
  }

  await dbReady;
  return {
    store: identityStore ?? new MemoryIdentityStore(),
    accounts: accountsRepo,
    scheduler: scanScheduler,
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

export function getItemDataProvider() {
  return createItemDataProvider({
    pitpandaApiKey: getPitPandaApiKey(),
    providerId: process.env.ITEM_DATA_PROVIDER,
  });
}

export function isUsingPostgres(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
