import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { accounts } from "../schema/accounts.js";
import { AccountsRepository } from "../accounts/repository.js";
import { getHypixelScansPaused } from "../accounts/scan-control.js";
import { staggeredNextScanAts } from "../accounts/scan-stagger.js";
import { JobsRepository } from "./repository.js";
import { now } from "../identity/store.js";

export interface ScheduleTickResult {
  considered: number;
  enqueued: number;
  skippedDuplicate: number;
  skippedDisabled: number;
  paused: boolean;
}

/**
 * Enqueue `scan_account` jobs for watchlisted+enabled accounts whose `next_scan_at` is due.
 * Global `hypixel_scans_paused` stops scheduled refresh without removing the watch list.
 * Manual Scan now still works so one-off checks don't require unpausing.
 */
export class ScanScheduler {
  private readonly accounts: AccountsRepository;
  private readonly jobs: JobsRepository;

  constructor(private readonly db: Database) {
    this.accounts = new AccountsRepository(db);
    this.jobs = new JobsRepository(db);
  }

  async tick(asOf: Date = now()): Promise<ScheduleTickResult> {
    if (await getHypixelScansPaused(this.db)) {
      return {
        considered: 0,
        enqueued: 0,
        skippedDuplicate: 0,
        skippedDisabled: 0,
        paused: true,
      };
    }

    const due = await this.accounts.listEnabledForScan(asOf);
    let enqueued = 0;
    let skippedDuplicate = 0;

    // When many accounts are due together, spread their *next* slots so the
    // cluster does not reform at asOf + interval for everyone.
    const burstNext =
      due.length > 1
        ? staggeredNextScanAts({
            count: due.length,
            // Use the max interval in the due set so slower accounts still spread.
            intervalSeconds: Math.max(...due.map((row) => row.scanIntervalSeconds)),
            from: asOf,
            mode: "after_burst",
          })
        : null;

    for (let i = 0; i < due.length; i += 1) {
      const account = due[i]!;
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

      const nextScanAt =
        burstNext?.[i] ??
        new Date(asOf.getTime() + account.scanIntervalSeconds * 1000);
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
      paused: false,
    };
  }

  /** Manual scan-now: enqueue immediately with a unique key; does not move schedule cursor. */
  async enqueueManualScan(
    accountId: string,
    asOf: Date = now(),
  ): Promise<{ jobId: string; created: boolean }> {
    const account = await this.accounts.get(accountId);
    if (!account) {
      throw new Error("Account not found");
    }
    if (!account.watchlisted) {
      throw new Error("Account is not on the watch list (ownership contacts are not auto-scanned)");
    }
    if (!account.enabled) {
      throw new Error("Account refresh is paused for this IGN");
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
