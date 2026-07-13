import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  JobsRepository,
  ScanScheduler,
  ScanAccountHandler,
  ProcessScanHandler,
  IdentityService,
  PostgresIdentityStore,
  createDb,
  runMigrations,
  seedAdminSettings,
  type Database,
} from "@pitantir/db";
import { MockInventorySource, type InventorySource } from "@pitantir/shared";
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
  inventory: InventorySource;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function createInventorySource(): InventorySource {
  const mode = (process.env.INVENTORY_SOURCE ?? "mock").toLowerCase();
  if (mode === "mock") {
    return new MockInventorySource();
  }
  console.warn(
    JSON.stringify({
      msg: "unknown INVENTORY_SOURCE; falling back to mock",
      mode,
    }),
  );
  return new MockInventorySource();
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
  const inventory = createInventorySource();
  const identity = new IdentityService(new PostgresIdentityStore(db));
  const scanAccount = new ScanAccountHandler(db, inventory);
  const processScan = new ProcessScanHandler(db, identity);

  const loop = new WorkerLoop({
    workerId,
    jobs,
    leaseMs: envInt("JOB_LEASE_MS", DEFAULT_LEASE_MS),
    handlers: {
      scan_account: async (job) => {
        const result = await scanAccount.handle(job);
        console.log(
          JSON.stringify({
            msg: "scan_account completed",
            jobId: job.id,
            scanId: result.scan.id,
            status: result.scan.status,
            itemCount: result.scan.itemCount,
            enqueuedProcessScan: result.enqueuedProcessScan,
            workerId,
          }),
        );
      },
      process_scan: async (job) => {
        const result = await processScan.handle(job);
        console.log(
          JSON.stringify({
            msg: "process_scan completed",
            jobId: job.id,
            scanId: result.scan.id,
            processingStatus: result.scan.processingStatus,
            observationCount: result.observations.length,
            resolvedCount: result.resolvedCount,
            workerId,
          }),
        );
      },
    },
  });

  return { db, client, jobs, scheduler, loop, workerId, inventory };
}

export async function runWorkerMain(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for the worker");
  }

  const pollMs = envInt("WORKER_POLL_MS", DEFAULT_POLL_MS);
  const { client, scheduler, loop, workerId } = await createWorkerRuntime(connectionString);

  console.log(
    JSON.stringify({
      msg: "worker started",
      workerId,
      pollMs,
      inventorySource: process.env.INVENTORY_SOURCE ?? "mock",
    }),
  );

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
