import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { MockInventorySource } from "@pitantir/shared/inventory";
import {
  AccountHistoryService,
  AccountsRepository,
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

describe("T32 account history", () => {
  let db: Database;
  let client: ReturnType<typeof postgres>;

  beforeAll(async () => {
    await resetDatabase();
    await runMigrations(databaseUrl, migrationsFolder);
    const created = createDb(databaseUrl, { max: 5 });
    db = created.db;
    client = created.client;
    await seedAdminSettings(db);
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it("renders scans, failures, and held items from fixtures", async () => {
    const accounts = new AccountsRepository(db);
    const jobs = new JobsRepository(db);
    const store = new PostgresIdentityStore(db);
    const identity = new IdentityService(store);
    const history = new AccountHistoryService(db, store);

    const account = await accounts.create({ mcUsername: "HistoryGuy" });

    const failSource = new MockInventorySource([
      {
        accountId: account.id,
        result: {
          ok: false,
          errorCode: "upstream_unavailable",
          errorMessage: "offline",
        },
      },
    ]);
    const failHandler = new ScanAccountHandler(db, failSource);
    const { job: failJob } = await jobs.enqueue({
      type: "scan_account",
      payload: { accountId: account.id, triggeredBy: "manual" },
      idempotencyKey: `scan_account_manual:${account.id}:hist-fail`,
    });
    await failHandler.handle(failJob);

    const okSource = new MockInventorySource([
      {
        accountId: account.id,
        result: {
          ok: true,
          observedAt: new Date("2026-07-13T18:00:00.000Z"),
          rawInventory: {
            inventory: [{ slot: 0, title: "Held", author: "H", nonce: "held-nonce-1", pages: "p" }],
          },
        },
      },
    ]);
    const okHandler = new ScanAccountHandler(db, okSource);
    const { job: okJob } = await jobs.enqueue({
      type: "scan_account",
      payload: { accountId: account.id, triggeredBy: "manual" },
      idempotencyKey: `scan_account_manual:${account.id}:hist-ok`,
    });
    const scanned = await okHandler.handle(okJob);
    const processJob = (await jobs.getByIdempotencyKey(`process_scan:${scanned.scan.id}`))!;
    await new ProcessScanHandler(db, identity).handle(processJob);

    const view = await history.getHistory(account.id);
    expect(view).not.toBeNull();
    expect(view!.scans.length).toBeGreaterThanOrEqual(2);
    expect(view!.failures.length).toBeGreaterThanOrEqual(1);
    expect(view!.failures[0]?.errorCode).toBe("upstream_unavailable");
    expect(view!.failures[0]?.rawInventoryHash).toBeNull();
    expect(view!.heldItems.length).toBeGreaterThanOrEqual(1);
    expect(view!.heldItems[0]?.primaryNonce).toBe("held-nonce-1");

    // Public summary must not expose raw inventory
    expect(
      view!.scans.every((scan) => !("rawInventory" in scan) || (scan as { rawInventory?: unknown }).rawInventory === undefined),
    ).toBe(true);
  });
});
