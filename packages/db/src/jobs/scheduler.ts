import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { accounts } from "../schema/accounts.js";
import { AccountsRepository } from "../accounts/repository.js";
import { JobsRepository } from "./repository.js";
import { now } from "../identity/store.js";

export interface ScheduleTickResult {
  considered: number;
  enqueued: number;
  skippedDuplicate: number;
  skippedDisabled: number;
}

/**
 * Enqueue `scan_account` jobs for enabled accounts whose `next_scan_at` is due.
 * Idempotency key is `scan_account:{accountId}:{nextScanAtISO}` so a slot cannot double-enqueue.
 * Schedule cursor advances after each account is considered (create or duplicate).
 */
export class ScanScheduler {
  private readonly accounts: AccountsRepository;
  private readonly jobs: JobsRepository;

  constructor(private readonly db: Database) {
    this.accounts = new AccountsRepository(db);
    this.jobs = new JobsRepository(db);
  }

  async tick(asOf: Date = now()): Promise<ScheduleTickResult> {
    const due = await this.accounts.listEnabledForScan(asOf);
    let enqueued = 0;
    let skippedDuplicate = 0;

    for (const account of due) {
      const slot = account.nextScanAt.toISOString();
      const idempotencyKey = `scan_account:${account.id}:${slot}`;
      const result = await this.jobs.enqueue({
        type: "scan_account",
        payload: {
          accountId: account.id,
          triggeredBy: "schedule",
        },
        priority: account.priority,
        runAt: asOf,
        idempotencyKey,
      });

      if (result.created) {
        enqueued += 1;
      } else {
        skippedDuplicate += 1;
      }

      const base = account.nextScanAt.getTime() > asOf.getTime() ? account.nextScanAt : asOf;
      const nextScanAt = new Date(base.getTime() + account.scanIntervalSeconds * 1000);
      await this.db
        .update(accounts)
        .set({ nextScanAt, updatedAt: asOf })
        .where(eq(accounts.id, account.id));
    }

    return {
      considered: due.length,
      enqueued,
      skippedDuplicate,
      skippedDisabled: 0,
    };
  }

  /** Manual scan-now: enqueue immediately with a unique key; does not move schedule cursor. */
  async enqueueManualScan(accountId: string, asOf: Date = now()): Promise<{ jobId: string; created: boolean }> {
    const account = await this.accounts.get(accountId);
    if (!account) {
      throw new Error("Account not found");
    }
    if (!account.enabled) {
      throw new Error("Account is disabled");
    }

    const result = await this.jobs.enqueue({
      type: "scan_account",
      payload: {
        accountId: account.id,
        triggeredBy: "manual",
      },
      priority: Math.min(account.priority, 50),
      runAt: asOf,
      idempotencyKey: `scan_account_manual:${account.id}:${asOf.toISOString()}`,
    });
    return { jobId: result.job.id, created: result.created };
  }
}
