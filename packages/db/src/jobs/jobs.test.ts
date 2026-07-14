import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import {
  AccountsRepository,
  JobsRepository,
  ScanScheduler,
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

describe("T13/T14 job claim/lease + scheduler", () => {
  let db: Database;
  let client: ReturnType<typeof postgres> | undefined;
  let clientB: ReturnType<typeof postgres> | undefined;
  let jobsA: JobsRepository;
  let jobsB: JobsRepository;

  beforeAll(async () => {
    await resetDatabase();
    await runMigrations(databaseUrl, migrationsFolder);

    const a = createDb(databaseUrl, { max: 3 });
    const b = createDb(databaseUrl, { max: 3 });
    db = a.db;
    client = a.client;
    clientB = b.client;
    await seedAdminSettings(db);

    jobsA = new JobsRepository(a.db);
    jobsB = new JobsRepository(b.db);
  });

  afterAll(async () => {
    if (client) {
      await client.end({ timeout: 5 });
    }
    if (clientB) {
      await clientB.end({ timeout: 5 });
    }
  });

  async function cancelOpenJobs(): Promise<void> {
    await db.execute(sql`
      UPDATE jobs
      SET status = 'cancelled', leased_by = NULL, lease_expires_at = NULL, updated_at = NOW()
      WHERE status IN ('pending', 'leased')
    `);
  }

  it("two workers do not claim the same job", async () => {
    await cancelOpenJobs();
    const { job } = await jobsA.enqueue({
      type: "scan_account",
      payload: { accountId: "acc-1" },
      idempotencyKey: `claim-race-${Date.now()}`,
    });

    const [first, second] = await Promise.all([
      jobsA.claimNext("worker-a", 30_000),
      jobsB.claimNext("worker-b", 30_000),
    ]);

    const claimed = [first, second].filter(Boolean);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.id).toBe(job.id);
    expect(claimed[0]!.status).toBe("leased");
    expect(claimed[0]!.attempts).toBe(1);
    expect(first && second).toBeFalsy();

    await jobsA.complete(job.id, claimed[0]!.leasedBy!);
  });

  it("expired lease can be reclaimed by another worker", async () => {
    await cancelOpenJobs();
    const { job } = await jobsA.enqueue({
      type: "scan_account",
      payload: { accountId: "acc-2" },
      idempotencyKey: `lease-expire-${Date.now()}`,
    });

    const claimed = await jobsA.claimNext("worker-a", 60_000);
    expect(claimed?.id).toBe(job.id);

    await jobsA.expireLease(job.id);
    const reclaimed = await jobsB.claimNext("worker-b", 60_000);
    expect(reclaimed?.id).toBe(job.id);
    expect(reclaimed?.leasedBy).toBe("worker-b");
    expect(reclaimed?.attempts).toBe(2);

    const stolen = await jobsA.heartbeat(job.id, "worker-a");
    expect(stolen).toBeNull();

    await jobsB.complete(job.id, "worker-b");
    const done = await jobsA.get(job.id);
    expect(done?.status).toBe("done");
  });

  it("heartbeat extends the lease", async () => {
    await cancelOpenJobs();
    const { job } = await jobsA.enqueue({
      type: "noop",
      payload: {},
      idempotencyKey: `heartbeat-${Date.now()}`,
    });
    const claimed = await jobsA.claimNext("worker-a", 5_000);
    expect(claimed?.id).toBe(job.id);
    const before = claimed!.leaseExpiresAt!.getTime();

    await new Promise((r) => setTimeout(r, 20));
    const beat = await jobsA.heartbeat(job.id, "worker-a", 60_000);
    expect(beat?.leaseExpiresAt!.getTime()).toBeGreaterThan(before);

    await jobsA.complete(job.id, "worker-a");
  });

  it("scheduler enqueues due accounts once per slot and skips disabled", async () => {
    await cancelOpenJobs();
    const accounts = new AccountsRepository(db);
    const enabled = await accounts.create({
      mcUsername: "DuePlayer",
      scanIntervalSeconds: 3600,
      priority: 10,
      watchlisted: true,
      enabled: true,
    });
    const disabled = await accounts.create({
      mcUsername: "OffPlayer",
      watchlisted: true,
      enabled: false,
    });
    const contact = await accounts.create({
      mcUsername: "ContactOnly",
      watchlisted: false,
      enabled: false,
      notes: "auto:pitpanda-owner",
    });

    const slotKey = `scan_account:${enabled.id}:${enabled.nextScanAt.toISOString()}`;
    const scheduler = new ScanScheduler(db);
    const first = await scheduler.tick();
    expect(first.enqueued).toBeGreaterThanOrEqual(1);
    expect(first.skippedDuplicate).toBe(0);

    const jobsForEnabled = await jobsA.getByIdempotencyKey(slotKey);
    expect(jobsForEnabled).not.toBeNull();
    expect(jobsForEnabled?.type).toBe("scan_account");
    expect(jobsForEnabled?.payload).toMatchObject({ accountId: enabled.id });

    const reloaded = await accounts.get(enabled.id);
    expect(reloaded!.nextScanAt.getTime()).toBeGreaterThan(enabled.nextScanAt.getTime());

    const second = await scheduler.tick();
    expect(second.considered).toBe(0);

    const disabledJobs = await jobsA.getByIdempotencyKey(
      `scan_account:${disabled.id}:${disabled.nextScanAt.toISOString()}`,
    );
    expect(disabledJobs).toBeNull();

    const contactJobs = await jobsA.getByIdempotencyKey(
      `scan_account:${contact.id}:${contact.nextScanAt.toISOString()}`,
    );
    expect(contactJobs).toBeNull();

    const dup = await jobsA.enqueue({
      type: "scan_account",
      payload: { accountId: enabled.id },
      idempotencyKey: slotKey,
    });
    expect(dup.created).toBe(false);
    expect(dup.job.id).toBe(jobsForEnabled!.id);
  });
});
