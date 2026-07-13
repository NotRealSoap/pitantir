import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { MockInventorySource } from "@pitantir/shared/inventory";
import {
  AccountsRepository,
  CatalogRepository,
  IdentityService,
  JobsRepository,
  PostgresIdentityStore,
  ProcessScanHandler,
  ScanAccountHandler,
  createDb,
  runMigrations,
  seedAdminSettings,
  type Database,
} from "../index.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://pitantir:pitantir@localhost:5432/pitantir_test";
const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "migrations",
);

async function resetDatabase(): Promise<void> {
  const sqlClient = postgres(databaseUrl, { max: 1 });
  try {
    await sqlClient.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await sqlClient.unsafe("DROP SCHEMA public CASCADE");
    await sqlClient.unsafe("CREATE SCHEMA public");
    await sqlClient.unsafe("GRANT ALL ON SCHEMA public TO pitantir");
    await sqlClient.unsafe("GRANT ALL ON SCHEMA public TO public");
  } finally {
    await sqlClient.end();
  }
}

describe("T33–T35 catalog queries", () => {
  let db: Database;
  let client: ReturnType<typeof postgres>;
  let catalog: CatalogRepository;

  beforeAll(async () => {
    await resetDatabase();
    await runMigrations(databaseUrl, migrationsFolder);
    const created = createDb(databaseUrl, { max: 5 });
    db = created.db;
    client = created.client;
    await seedAdminSettings(db);
    catalog = new CatalogRepository(db);

    const accounts = new AccountsRepository(db);
    const jobs = new JobsRepository(db);
    const identity = new IdentityService(new PostgresIdentityStore(db));
    const account = await accounts.create({ mcUsername: "CatalogUser" });
    const source = new MockInventorySource([
      {
        accountId: account.id,
        result: {
          ok: true,
          observedAt: new Date("2026-07-13T19:00:00.000Z"),
          rawInventory: {
            inventory: [
              { slot: 0, title: "Catalog Book", author: "C", nonce: "catalog-nonce-99", pages: "z" },
            ],
          },
        },
      },
    ]);
    const scanHandler = new ScanAccountHandler(db, source);
    const { job } = await jobs.enqueue({
      type: "scan_account",
      payload: { accountId: account.id, triggeredBy: "manual" },
      idempotencyKey: `scan_account_manual:${account.id}:catalog`,
    });
    const scanned = await scanHandler.handle(job);
    const processJob = (await jobs.getByIdempotencyKey(`process_scan:${scanned.scan.id}`))!;
    await new ProcessScanHandler(db, identity).handle(processJob);
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it("filters items by nonce and location known", async () => {
    const byNonce = await catalog.listItems({ nonce: "catalog-nonce" });
    expect(byNonce.length).toBeGreaterThanOrEqual(1);
    expect(byNonce[0]?.primaryNonce).toContain("catalog-nonce");

    const known = await catalog.listItems({ location: "known" });
    expect(known.some((row) => row.primaryNonce === "catalog-nonce-99")).toBe(true);

    const unknown = await catalog.listItems({ location: "unknown" });
    expect(unknown.every((row) => row.primaryNonce !== "catalog-nonce-99")).toBe(true);
  });

  it("loads item detail with identifiers and periods", async () => {
    const listed = await catalog.listItems({ nonce: "catalog-nonce-99" });
    const detail = await catalog.getItemDetail(listed[0]!.id);
    expect(detail).not.toBeNull();
    expect(detail!.identifiers.length).toBeGreaterThan(0);
    expect(detail!.currentLocation?.mcUsername).toBe("CatalogUser");
    expect(detail!.observations.length).toBeGreaterThan(0);
  });

  it("lists scans with failure vs success distinction", async () => {
    const accounts = new AccountsRepository(db);
    const jobs = new JobsRepository(db);
    const account = await accounts.create({ mcUsername: "FailScanUser" });
    const failSource = new MockInventorySource([
      {
        accountId: account.id,
        result: {
          ok: false,
          errorCode: "timeout",
          errorMessage: "timed out",
        },
      },
    ]);
    const { job } = await jobs.enqueue({
      type: "scan_account",
      payload: { accountId: account.id, triggeredBy: "manual" },
      idempotencyKey: `scan_account_manual:${account.id}:catalog-fail`,
    });
    await new ScanAccountHandler(db, failSource).handle(job);

    const scans = await catalog.listScansWithAccounts();
    const failure = scans.find((scan) => scan.accountId === account.id);
    expect(failure?.status).toBe("failure");
    expect(failure?.errorCode).toBe("timeout");
    expect(failure?.itemCount).toBeNull();
    expect(failure?.mcUsername).toBe("FailScanUser");
  });
});
