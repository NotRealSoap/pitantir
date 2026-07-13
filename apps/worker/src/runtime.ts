import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  JobsRepository,
  ScanScheduler,
  createDb,
  runMigrations,
  seedAdminSettings,
  type Database,
} from "@pitantir/db";
import type postgres from "postgres";
import { WorkerLoop } from "./loop.js";

const DEFAULT_POLL_MS = 2_000;
const DEFAULT_LEASE_MS = 60_000;

export interface WorkerRuntime {
  db: Database;
  client: postgres.Sql;
  jobs: JobsRepository;
  scheduler: ScanScheduler;
  loop: WorkerLoop;
  workerId: string;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function createWorkerRuntime(connectionString: string): Promise<WorkerRuntime> {
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "packages",
    "db",
    "migrations",
  );
  await runMigrations(connectionString, migrationsFolder);

  const { db, client } = createDb(connectionString, { max: 5 });
  await seedAdminSettings(db);

  const jobs = new JobsRepository(db);
  const scheduler = new ScanScheduler(db);
  const workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;

  const loop = new WorkerLoop({
    workerId,
    jobs,
    leaseMs: envInt("JOB_LEASE_MS", DEFAULT_LEASE_MS),
    handlers: {
      // T16 will replace this stub with real inventory fetch + scan persistence.
      scan_account: async (job) => {
        console.log(
          JSON.stringify({
            msg: "scan_account stub",
            jobId: job.id,
            accountId: job.payload.accountId,
            workerId,
          }),
        );
      },
      process_scan: async (job) => {
        console.log(
          JSON.stringify({
            msg: "process_scan stub",
            jobId: job.id,
            scanId: job.payload.scanId,
            workerId,
          }),
        );
      },
    },
  });

  return { db, client, jobs, scheduler, loop, workerId };
}

export async function runWorkerMain(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for the worker");
  }

  const pollMs = envInt("WORKER_POLL_MS", DEFAULT_POLL_MS);
  const { client, scheduler, loop, workerId } = await createWorkerRuntime(connectionString);

  console.log(JSON.stringify({ msg: "worker started", workerId, pollMs }));

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  try {
    while (!stopping) {
      await scheduler.tick();
      const claimed = await loop.tick();
      if (!claimed) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    }
  } finally {
    await client.end({ timeout: 5 });
    console.log(JSON.stringify({ msg: "worker stopped", workerId }));
  }
}
