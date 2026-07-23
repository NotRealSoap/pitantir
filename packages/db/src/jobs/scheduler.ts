import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { accounts } from "../schema/accounts.js";
import { AccountsRepository } from "../accounts/repository.js";
import { getHypixelScansPaused } from "../accounts/scan-control.js";
import { getHypixelRateLimitSnapshot } from "../accounts/hypixel-usage.js";
import { isHypixelApiCircuitOpen } from "../accounts/hypixel-circuit.js";
import {
  effectiveScanIntervalSeconds,
  effectiveScanPriority,
} from "../accounts/presence.js";
import { isPitpalPresenceAuthoritative } from "../accounts/pitpal-lobbies.js";
import { scanEnqueueAllowance } from "@pitantir/shared/inventory";
import { JobsRepository } from "./repository.js";
import { now } from "../identity/store.js";

export interface ScheduleTickResult {
  considered: number;
  enqueued: number;
  deferred: number;
  skippedDuplicate: number;
  skippedDisabled: number;
  paused: boolean;
  allowance: number;
}

/**
 * Hard ceiling per worker loop tick. Budget pacing usually asks for fewer.
 * Keeps a due pile from becoming a burst when quota is far behind target.
 */
export const MAX_SCAN_ENQUEUES_PER_TICK = 4;

/**
 * Enqueue `scan_account` jobs for watchlisted+enabled accounts whose `next_scan_at` is due.
 * Global `hypixel_scans_paused` stops scheduled refresh without removing the watch list.
 * Manual Scan now still works so one-off checks don't require unpausing.
 *
 * Cadence aims for ~80% of the Hypixel key window (e.g. ~240 of 300 / 5min) using the
 * latest RateLimit snapshot. Per-account intervals still apply (140ers ≥ 30 minutes).
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
        deferred: 0,
        skippedDuplicate: 0,
        skippedDisabled: 0,
        paused: true,
        allowance: 0,
      };
    }

    const due = await this.accounts.listEnabledForScan(asOf);
    const presenceOpts = {
      pitpalAuthoritative: await isPitpalPresenceAuthoritative(this.db),
    };
    // Prefer hotspots first, then earliest nextScanAt.
    const ordered = [...due].sort((a, b) => {
      const pri =
        effectiveScanPriority(a, presenceOpts) - effectiveScanPriority(b, presenceOpts);
      if (pri !== 0) return pri;
      return a.nextScanAt.getTime() - b.nextScanAt.getTime();
    });

    const snapshot = await getHypixelRateLimitSnapshot(this.db);
    const allowance = scanEnqueueAllowance({
      snapshot,
      dueCount: ordered.length,
      maxPerTick: MAX_SCAN_ENQUEUES_PER_TICK,
      now: asOf,
    });
    const batch = ordered.slice(0, allowance);
    const deferred = Math.max(0, ordered.length - batch.length);

    let enqueued = 0;
    let skippedDuplicate = 0;

    for (const account of batch) {
      const slot = account.nextScanAt.toISOString();
      const idempotencyKey = `scan_account:${account.id}:${slot}`;
      const result = await this.jobs.enqueue({
        type: "scan_account",
        payload: {
          accountId: account.id,
          triggeredBy: "schedule",
        },
        priority: effectiveScanPriority(account, presenceOpts),
        runAt: asOf,
        idempotencyKey,
      });

      if (result.created) {
        enqueued += 1;
      } else {
        skippedDuplicate += 1;
      }

      // Each account uses its own effective interval (hot / cool / 140er floor).
      const nextScanAt = new Date(
        asOf.getTime() + effectiveScanIntervalSeconds(account, presenceOpts) * 1000,
      );
      await this.db
        .update(accounts)
        .set({ nextScanAt, updatedAt: asOf })
        .where(eq(accounts.id, account.id));
    }

    return {
      considered: due.length,
      enqueued,
      deferred,
      skippedDuplicate,
      skippedDisabled: 0,
      paused: false,
      allowance,
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
    if ((await getHypixelScansPaused(this.db)) || (await isHypixelApiCircuitOpen(this.db))) {
      throw new Error(
        "Hypixel API calls are paused (manual pause or consecutive-failure circuit). Resume from Accounts when ready.",
      );
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
