import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { MockInventorySource } from "@pitantir/shared";
import {
  AccountsRepository,
  IdentityService,
  JobsRepository,
  PostgresIdentityStore,
  ProcessScanHandler,
  ScanAccountHandler,
  ScansRepository,
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

describe("T15–T18 scanning pipeline", () => {
  let db: Database;
  let client: ReturnType<typeof postgres>;
  let accounts: AccountsRepository;
  let jobs: JobsRepository;
  let identity: IdentityService;
  let scans: ScansRepository;

  beforeAll(async () => {
    await resetDatabase();
    await runMigrations(databaseUrl, migrationsFolder);
    const created = createDb(databaseUrl, { max: 5 });
    db = created.db;
    client = created.client;
    await seedAdminSettings(db);
    accounts = new AccountsRepository(db);
    jobs = new JobsRepository(db);
    identity = new IdentityService(new PostgresIdentityStore(db));
    scans = new ScansRepository(db);
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it("failure leaves no observations; success stores hash + raw JSON", async () => {
    const account = await accounts.create({ mcUsername: "FailThenOk" });
    const failSource = new MockInventorySource(
      [
        {
          accountId: account.id,
          result: {
            ok: false,
            errorCode: "upstream_unavailable",
            errorMessage: "pit offline",
          },
        },
      ],
      { defaultFailure: true },
    );

    const failHandler = new ScanAccountHandler(db, failSource);
    const { job: failJob } = await jobs.enqueue({
      type: "scan_account",
      payload: { accountId: account.id, triggeredBy: "manual" },
      idempotencyKey: `scan_account_manual:${account.id}:fail`,
    });
    const failResult = await failHandler.handle(failJob);
    expect(failResult.scan.status).toBe("failure");
    expect(failResult.scan.rawInventory).toBeNull();
    expect(failResult.scan.itemCount).toBeNull();
    expect(failResult.enqueuedProcessScan).toBe(false);
    expect(await identity.listObservationsForScan(failResult.scan.id)).toHaveLength(0);

    const okSource = new MockInventorySource([
      {
        accountId: account.id,
        result: {
          ok: true,
          observedAt: new Date("2026-07-13T12:00:00.000Z"),
          rawInventory: {
            inventory: [
              { slot: 0, title: "Alpha", author: "A", nonce: "nonce-a", pages: "1" },
              { slot: 1, title: "Beta", author: "B", nonce: "nonce-b", pages: "2" },
            ],
          },
        },
      },
    ]);
    const okHandler = new ScanAccountHandler(db, okSource);
    const { job: okJob } = await jobs.enqueue({
      type: "scan_account",
      payload: { accountId: account.id, triggeredBy: "manual" },
      idempotencyKey: `scan_account_manual:${account.id}:ok`,
    });
    const okResult = await okHandler.handle(okJob);
    expect(okResult.scan.status).toBe("success");
    expect(okResult.scan.rawInventory).toMatchObject({ inventory: expect.any(Array) });
    expect(okResult.scan.rawInventoryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(okResult.scan.itemCount).toBe(2);
    expect(okResult.enqueuedProcessScan).toBe(true);

    const processJob = await jobs.getByIdempotencyKey(`process_scan:${okResult.scan.id}`);
    expect(processJob).not.toBeNull();
  });

  it("reprocess same scan keeps observation row count / natural keys", async () => {
    const account = await accounts.create({ mcUsername: "Reprocess" });
    const source = new MockInventorySource([
      {
        accountId: account.id,
        result: {
          ok: true,
          observedAt: new Date("2026-07-13T13:00:00.000Z"),
          rawInventory: {
            inventory: [{ slot: 4, title: "Only", author: "O", nonce: "only-1", pages: "x" }],
            ender_chest: [{ slot: 0, title: "E", author: "E", nonce: "e-1", pages: "y" }],
          },
        },
      },
    ]);
    const scanHandler = new ScanAccountHandler(db, source);
    const { job } = await jobs.enqueue({
      type: "scan_account",
      payload: { accountId: account.id, triggeredBy: "schedule" },
      idempotencyKey: `scan_account:${account.id}:slot-reprocess`,
    });
    const scanned = await scanHandler.handle(job);
    const processHandler = new ProcessScanHandler(db, identity);
    const { job: processJob } = await jobs.enqueue({
      type: "process_scan",
      payload: { scanId: scanned.scan.id },
      idempotencyKey: `process_scan:${scanned.scan.id}`,
    });

    const first = await processHandler.handle(processJob);
    expect(first.observations).toHaveLength(2);
    expect(first.observations.map((o) => o.slotKey).sort()).toEqual(["echest:0", "inv:4"]);
    expect(first.scan.processingStatus).toBe("processed");
    expect(first.resolvedCount).toBeGreaterThanOrEqual(1);

    const second = await processHandler.handle(processJob);
    expect(second.observations).toHaveLength(2);
    expect(second.observations.map((o) => o.slotKey).sort()).toEqual(["echest:0", "inv:4"]);
    expect(new Set(second.observations.map((o) => o.id))).toEqual(
      new Set(first.observations.map((o) => o.id)),
    );
  });

  it("end-to-end mock success scan through worker handlers", async () => {
    const account = await accounts.create({ mcUsername: "E2EPlayer" });
    const source = new MockInventorySource();
    const scanHandler = new ScanAccountHandler(db, source);
    const processHandler = new ProcessScanHandler(db, identity);

    const { job } = await jobs.enqueue({
      type: "scan_account",
      payload: { accountId: account.id, triggeredBy: "manual" },
      idempotencyKey: `scan_account_manual:${account.id}:e2e`,
    });
    const scanned = await scanHandler.handle(job);
    expect(scanned.scan.status).toBe("success");

    const processJob = (await jobs.getByIdempotencyKey(`process_scan:${scanned.scan.id}`))!;
    const processed = await processHandler.handle(processJob);
    expect(processed.scan.processingStatus).toBe("processed");
    expect(processed.observations.length).toBeGreaterThan(0);

    const reloaded = await scans.get(scanned.scan.id);
    expect(reloaded?.itemCount).toBe(processed.observations.length);
    const accountAfter = await accounts.get(account.id);
    expect(accountAfter?.lastSuccessScanAt).not.toBeNull();
  });
});
