import { and, eq, sql } from "drizzle-orm";
import type { JobStatus } from "@pitantir/shared";
import type { Database } from "../client.js";
import { jobs, type JobRow } from "../schema/jobs.js";
import { newId, now } from "../identity/store.js";

export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  runAt: Date;
  leasedBy: string | null;
  leaseExpiresAt: Date | null;
  attempts: number;
  lastError: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnqueueJobInput {
  type: string;
  payload: Record<string, unknown>;
  priority?: number;
  runAt?: Date;
  idempotencyKey?: string | null;
}

export interface EnqueueResult {
  job: Job;
  created: boolean;
}

const DEFAULT_LEASE_MS = 60_000;

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload as Record<string, unknown>,
    status: row.status,
    priority: row.priority,
    runAt: row.runAt,
    leasedBy: row.leasedBy,
    leaseExpiresAt: row.leaseExpiresAt,
    attempts: row.attempts,
    lastError: row.lastError,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowFromRaw(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    type: String(row.type),
    payload: row.payload as Record<string, unknown>,
    status: row.status as JobStatus,
    priority: Number(row.priority),
    runAt: new Date(row.run_at as string | Date),
    leasedBy: (row.leased_by as string | null) ?? null,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at as string | Date) : null,
    attempts: Number(row.attempts),
    lastError: (row.last_error as string | null) ?? null,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    createdAt: new Date(row.created_at as string | Date),
    updatedAt: new Date(row.updated_at as string | Date),
  };
}

export class JobsRepository {
  constructor(private readonly db: Database) {}

  async get(id: string): Promise<Job | null> {
    const rows = await this.db.select().from(jobs).where(eq(jobs.id, id));
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async getByIdempotencyKey(key: string): Promise<Job | null> {
    const rows = await this.db.select().from(jobs).where(eq(jobs.idempotencyKey, key));
    return rows[0] ? mapJob(rows[0]) : null;
  }

  /**
   * Insert a job. When `idempotencyKey` is set and already exists, returns the existing row.
   */
  async enqueue(input: EnqueueJobInput): Promise<EnqueueResult> {
    const timestamp = now();
    const id = newId();
    const values = {
      id,
      type: input.type,
      payload: input.payload,
      status: "pending" as const,
      priority: input.priority ?? 100,
      runAt: input.runAt ?? timestamp,
      leasedBy: null,
      leaseExpiresAt: null,
      attempts: 0,
      lastError: null,
      idempotencyKey: input.idempotencyKey ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    if (input.idempotencyKey) {
      const inserted = await this.db
        .insert(jobs)
        .values(values)
        .onConflictDoNothing({ target: jobs.idempotencyKey })
        .returning();
      if (inserted[0]) {
        return { job: mapJob(inserted[0]), created: true };
      }
      const existing = await this.getByIdempotencyKey(input.idempotencyKey);
      if (!existing) {
        throw new Error("Job idempotency conflict without existing row");
      }
      return { job: existing, created: false };
    }

    const inserted = await this.db.insert(jobs).values(values).returning();
    return { job: mapJob(inserted[0]!), created: true };
  }

  /**
   * Claim the next available job (pending due, or leased with expired lease).
   * Uses `FOR UPDATE SKIP LOCKED` so concurrent workers never claim the same row.
   */
  async claimNext(
    workerId: string,
    leaseMs: number = DEFAULT_LEASE_MS,
    asOf: Date = now(),
  ): Promise<Job | null> {
    const leaseExpiresAt = new Date(asOf.getTime() + leaseMs);
    const asOfIso = asOf.toISOString();
    const leaseExpiresIso = leaseExpiresAt.toISOString();
    const result = await this.db.execute(sql`
      WITH candidate AS (
        SELECT id
        FROM jobs
        WHERE
          (status = 'pending' AND run_at <= ${asOfIso}::timestamptz)
          OR (status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at < ${asOfIso}::timestamptz)
        ORDER BY
          CASE WHEN status = 'leased' THEN 0 ELSE 1 END,
          priority ASC,
          run_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE jobs AS j
      SET
        status = 'leased',
        leased_by = ${workerId},
        lease_expires_at = ${leaseExpiresIso}::timestamptz,
        attempts = j.attempts + 1,
        updated_at = ${asOfIso}::timestamptz,
        last_error = CASE
          WHEN j.status = 'leased' THEN coalesce(j.last_error, 'lease expired; reclaimed')
          ELSE j.last_error
        END
      FROM candidate
      WHERE j.id = candidate.id
      RETURNING j.*
    `);

    const rows = result as unknown as Record<string, unknown>[];
    const row = rows[0];
    return row ? rowFromRaw(row) : null;
  }

  async heartbeat(
    jobId: string,
    workerId: string,
    leaseMs: number = DEFAULT_LEASE_MS,
    asOf: Date = now(),
  ): Promise<Job | null> {
    const leaseExpiresAt = new Date(asOf.getTime() + leaseMs);
    const updated = await this.db
      .update(jobs)
      .set({
        leaseExpiresAt,
        updatedAt: asOf,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.leasedBy, workerId), eq(jobs.status, "leased")))
      .returning();
    return updated[0] ? mapJob(updated[0]) : null;
  }

  async complete(jobId: string, workerId: string, asOf: Date = now()): Promise<Job | null> {
    const updated = await this.db
      .update(jobs)
      .set({
        status: "done",
        leasedBy: null,
        leaseExpiresAt: null,
        updatedAt: asOf,
        lastError: null,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.leasedBy, workerId), eq(jobs.status, "leased")))
      .returning();
    return updated[0] ? mapJob(updated[0]) : null;
  }

  async fail(
    jobId: string,
    workerId: string,
    errorMessage: string,
    asOf: Date = now(),
  ): Promise<Job | null> {
    const updated = await this.db
      .update(jobs)
      .set({
        status: "failed",
        leasedBy: null,
        leaseExpiresAt: null,
        lastError: errorMessage.slice(0, 4000),
        updatedAt: asOf,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.leasedBy, workerId), eq(jobs.status, "leased")))
      .returning();
    return updated[0] ? mapJob(updated[0]) : null;
  }

  /** Force-expire a lease (test helper / admin). */
  async expireLease(jobId: string, asOf: Date = now()): Promise<void> {
    await this.db
      .update(jobs)
      .set({ leaseExpiresAt: new Date(asOf.getTime() - 1), updatedAt: asOf })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "leased")));
  }
}
