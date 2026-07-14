import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  JobsRepository,
  createDb,
  runMigrations,
  seedAdminSettings,
} from "@pitantir/db";
import { WorkerLoop } from "./loop.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://pitantir:pitantir@localhost:5432/pitantir_test";
const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "db",
  "migrations",
);

async function resetDatabase(): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await sql.unsafe("DROP SCHEMA public CASCADE");
    await sql.unsafe("CREATE SCHEMA public");
    await sql.unsafe("GRANT ALL ON SCHEMA public TO pitantir");
    await sql.unsafe("GRANT ALL ON SCHEMA public TO public");
  } finally {
    await sql.end();
  }
}

describe("worker loop", () => {
  let client: ReturnType<typeof postgres>;
  let jobs: JobsRepository;

  beforeAll(async () => {
    await resetDatabase();
    await runMigrations(databaseUrl, migrationsFolder);
    const created = createDb(databaseUrl, { max: 3 });
    client = created.client;
    await seedAdminSettings(created.db);
    jobs = new JobsRepository(created.db);
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it("completes known handlers and fails unknown types", async () => {
    const { job: okJob } = await jobs.enqueue({
      type: "scan_account",
      payload: { accountId: "x" },
      priority: 1,
      idempotencyKey: `loop-ok-${Date.now()}`,
    });
    const { job: badJob } = await jobs.enqueue({
      type: "boom",
      payload: {},
      priority: 2,
      idempotencyKey: `loop-bad-${Date.now()}`,
    });

    const loop = new WorkerLoop({
      workerId: "loop-worker",
      jobs,
      handlers: {
        scan_account: async () => {},
      },
    });

    expect(await loop.tick()).toBe(true);
    expect(await loop.tick()).toBe(true);
    expect(await loop.tick()).toBe(false);

    const done = await jobs.get(okJob.id);
    const failed = await jobs.get(badJob.id);
    expect(done?.status).toBe("done");
    expect(failed?.status).toBe("failed");
    expect(failed?.lastError).toMatch(/No handler registered/);
  });
});
