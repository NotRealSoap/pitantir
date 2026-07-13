import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { MockInventorySource } from "@pitantir/shared/inventory";
import {
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

async function runScan(
  db: Database,
  identity: IdentityService,
  accountId: string,
  inventory: Array<Record<string, unknown>>,
  key: string,
) {
  const jobs = new JobsRepository(db);
  const source = new MockInventorySource([
    {
      accountId,
      result: {
        ok: true,
        observedAt: new Date(),
        rawInventory: { inventory },
      },
    },
  ]);
  const { job } = await jobs.enqueue({
    type: "scan_account",
    payload: { accountId, triggeredBy: "manual" },
    idempotencyKey: key,
  });
  const scanned = await new ScanAccountHandler(db, source).handle(job);
  const processJob = (await jobs.getByIdempotencyKey(`process_scan:${scanned.scan.id}`))!;
  return new ProcessScanHandler(db, identity).handle(processJob);
}

describe("T25–T28 location engine", () => {
  let db: Database;
  let client: ReturnType<typeof postgres>;
  let accounts: AccountsRepository;
  let identity: IdentityService;
  let store: PostgresIdentityStore;

  beforeAll(async () => {
    await resetDatabase();
    await runMigrations(databaseUrl, migrationsFolder);
    const created = createDb(databaseUrl, { max: 5 });
    db = created.db;
    client = created.client;
    await seedAdminSettings(db);
    accounts = new AccountsRepository(db);
    store = new PostgresIdentityStore(db);
    identity = new IdentityService(store);
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it("T25: failed scan does not close open presence", async () => {
    const account = await accounts.create({ mcUsername: "LocFail" });
    await runScan(
      db,
      identity,
      account.id,
      [{ slot: 0, title: "Keep", author: "A", nonce: "loc-fail-1", pages: "p" }],
      `scan_account_manual:${account.id}:keep`,
    );
    const openBefore = await store.listOpenPresenceOnAccount(account.id);
    expect(openBefore.length).toBe(1);

    const jobs = new JobsRepository(db);
    const failSource = new MockInventorySource([
      {
        accountId: account.id,
        result: {
          ok: false,
          errorCode: "upstream_unavailable",
          errorMessage: "down",
        },
      },
    ]);
    const { job } = await jobs.enqueue({
      type: "scan_account",
      payload: { accountId: account.id, triggeredBy: "manual" },
      idempotencyKey: `scan_account_manual:${account.id}:fail`,
    });
    const failed = await new ScanAccountHandler(db, failSource).handle(job);
    expect(failed.scan.status).toBe("failure");
    expect(failed.enqueuedProcessScan).toBe(false);

    const openAfter = await store.listOpenPresenceOnAccount(account.id);
    expect(openAfter.length).toBe(1);
    expect(openAfter[0]?.itemId).toBe(openBefore[0]?.itemId);
  });

  it("T25: successful empty inventory closes presence into unknown gap", async () => {
    const account = await accounts.create({ mcUsername: "LocEmpty" });
    const first = await runScan(
      db,
      identity,
      account.id,
      [{ slot: 0, title: "Gone", author: "A", nonce: "loc-empty-1", pages: "p" }],
      `scan_account_manual:${account.id}:first`,
    );
    expect(first.resolvedCount).toBe(1);
    const itemId = first.observations[0]?.canonicalItemId!;
    expect(itemId).toBeTruthy();

    await runScan(db, identity, account.id, [], `scan_account_manual:${account.id}:empty`);

    const periods = await store.listLocationPeriodsForItem(itemId);
    const closed = periods.find((period) => period.accountId === account.id && period.endedAt);
    const gap = periods.find((period) => period.isUnknownGap && period.endedAt === null);
    expect(closed?.endReason).toBe("disappeared");
    expect(gap).toBeTruthy();

    const events = await store.listLocationEventsForItem(itemId);
    expect(events.some((event) => event.eventType === "disappeared")).toBe(true);
    expect(events.some((event) => event.eventType === "unknown_started")).toBe(true);
  });

  it("T26: absence on A then presence on B yields move_confirmed", async () => {
    const accountA = await accounts.create({ mcUsername: "LocMoveA" });
    const accountB = await accounts.create({ mcUsername: "LocMoveB" });
    const first = await runScan(
      db,
      identity,
      accountA.id,
      [{ slot: 0, title: "Traveler", author: "A", nonce: "loc-move-1", pages: "p" }],
      `scan_account_manual:${accountA.id}:hold`,
    );
    const itemId = first.observations[0]?.canonicalItemId!;

    await runScan(db, identity, accountA.id, [], `scan_account_manual:${accountA.id}:left`);
    await runScan(
      db,
      identity,
      accountB.id,
      [{ slot: 0, title: "Traveler", author: "A", nonce: "loc-move-1", pages: "p" }],
      `scan_account_manual:${accountB.id}:arrived`,
    );

    const events = await store.listLocationEventsForItem(itemId);
    expect(events.some((event) => event.eventType === "move_confirmed")).toBe(true);
    const openB = (await store.listOpenPresenceOnAccount(accountB.id)).some(
      (period) => period.itemId === itemId,
    );
    expect(openB).toBe(true);
  });

  it("T26/T28: presence on B while still open on A is uncertain/contradiction, not silent confirm", async () => {
    const accountA = await accounts.create({ mcUsername: "LocDualA" });
    const accountB = await accounts.create({ mcUsername: "LocDualB" });
    const first = await runScan(
      db,
      identity,
      accountA.id,
      [{ slot: 0, title: "TwinRisk", author: "A", nonce: "loc-dual-1", pages: "p" }],
      `scan_account_manual:${accountA.id}:hold`,
    );
    const itemId = first.observations[0]?.canonicalItemId!;

    await runScan(
      db,
      identity,
      accountB.id,
      [{ slot: 0, title: "TwinRisk", author: "A", nonce: "loc-dual-1", pages: "p" }],
      `scan_account_manual:${accountB.id}:overlap`,
    );

    const events = await store.listLocationEventsForItem(itemId);
    expect(events.some((event) => event.eventType === "move_uncertain")).toBe(true);
    expect(events.some((event) => event.eventType === "contradiction")).toBe(true);
    expect(events.some((event) => event.eventType === "move_confirmed")).toBe(false);

    const periods = await store.listLocationPeriodsForItem(itemId);
    const open = periods.filter((period) => period.endedAt === null && !period.isUnknownGap);
    expect(open.length).toBeGreaterThanOrEqual(2);
    expect(open.every((period) => period.certainty === "contradicted")).toBe(true);
  });

  it("T27: reprocessing the same scan does not duplicate location events", async () => {
    const account = await accounts.create({ mcUsername: "LocIdem" });
    const first = await runScan(
      db,
      identity,
      account.id,
      [{ slot: 0, title: "Stable", author: "A", nonce: "loc-idem-1", pages: "p" }],
      `scan_account_manual:${account.id}:once`,
    );
    const itemId = first.observations[0]?.canonicalItemId!;
    const before = (await store.listLocationEventsForItem(itemId)).length;

    // Already processed — handler returns early without new events
    const jobs = new JobsRepository(db);
    const processJob = (await jobs.getByIdempotencyKey(
      `process_scan:${first.scan.id}`,
    ))!;
    await new ProcessScanHandler(db, identity).handle(processJob);
    const after = (await store.listLocationEventsForItem(itemId)).length;
    expect(after).toBe(before);
  });
});
