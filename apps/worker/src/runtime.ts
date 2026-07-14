import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  JobsRepository,
  ScanScheduler,
  ScanAccountHandler,
  ProcessScanHandler,
  IdentityService,
  PostgresIdentityStore,
  AccountsRepository,
  createDb,
  runMigrations,
  seedAdminSettings,
  getHypixelRateLimitSnapshot,
  setHypixelRateLimitSnapshot,
  appendHypixelApiCall,
  type Database,
} from "@pitantir/db";
import { randomUUID } from "node:crypto";
import {
  MockInventorySource,
  type InventorySource,
} from "@pitantir/shared/inventory";
import { HypixelPitInventorySource } from "@pitantir/shared/inventory/hypixel";
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

/** Load root .env and apps/web/.env.local without overriding existing process env. */
export function loadWorkerEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(here, "..", "..", "..");
  loadDotenv({ path: path.join(repoRoot, ".env") });
  loadDotenv({ path: path.join(repoRoot, "apps", "web", ".env.local") });
}

function createInventorySource(db: Database): InventorySource {
  const mode = (process.env.INVENTORY_SOURCE ?? "mock").toLowerCase();
  if (mode === "mock") {
    return new MockInventorySource();
  }
  if (mode === "hypixel_pit" || mode === "hypixel") {
    const apiKey = process.env.HYPIXEL_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "INVENTORY_SOURCE=hypixel_pit requires HYPIXEL_API_KEY (save it on /settings and restart the worker)",
      );
    }
    const accounts = new AccountsRepository(db);
    const fetchOnlineStatus =
      (process.env.HYPIXEL_STATUS_CHECKS ?? "").toLowerCase() === "1" ||
      (process.env.HYPIXEL_STATUS_CHECKS ?? "").toLowerCase() === "true";
    return new HypixelPitInventorySource({
      apiKey,
      fetchOnlineStatus,
      getPreviousWindowSeconds: async () => {
        const previous = await getHypixelRateLimitSnapshot(db);
        return previous?.windowSeconds ?? null;
      },
      onRateLimitObserved: async (snapshot) => {
        try {
          await setHypixelRateLimitSnapshot(db, snapshot);
        } catch (error) {
          console.warn(
            JSON.stringify({
              msg: "failed to persist hypixel rate limit",
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      },
      onApiCall: async (call) => {
        try {
          await appendHypixelApiCall(db, {
            id: randomUUID(),
            at: new Date().toISOString(),
            endpoint: call.endpoint,
            accountId: call.accountId ?? null,
            mcUsername: call.mcUsername ?? null,
            ok: call.ok,
            statusCode: call.statusCode,
            detail: call.detail ?? null,
          });
        } catch (error) {
          console.warn(
            JSON.stringify({
              msg: "failed to persist hypixel api call",
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      },
      onIdentityResolved: async (accountId, identity) => {
        try {
          await accounts.update(accountId, {
            mcUuid: identity.mcUuid,
            mcUsername: identity.mcUsername,
          });
        } catch (error) {
          // Case-only username updates should succeed; if username uniquely collides, still save UUID.
          try {
            await accounts.update(accountId, { mcUuid: identity.mcUuid });
          } catch (uuidError) {
            console.warn(
              JSON.stringify({
                msg: "failed to persist resolved identity",
                accountId,
                error: error instanceof Error ? error.message : String(error),
                uuidError: uuidError instanceof Error ? uuidError.message : String(uuidError),
              }),
            );
          }
        }
      },
    });
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
  const inventory = createInventorySource(db);
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
            inventorySource: result.inventorySource ?? inventory.id,
            observedNonces: result.observedNonces ?? [],
            observedItemUuids: result.observedItemUuids ?? [],
            enqueuedProcessScan: result.enqueuedProcessScan,
            resolvedMcUuid: result.resolvedMcUuid ?? null,
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
  loadWorkerEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for the worker");
  }

  const pollMs = envInt("WORKER_POLL_MS", DEFAULT_POLL_MS);
  const { client, scheduler, loop, workerId, inventory } =
    await createWorkerRuntime(connectionString);

  console.log(
    JSON.stringify({
      msg: "worker started",
      workerId,
      pollMs,
      inventorySource: inventory.id,
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
