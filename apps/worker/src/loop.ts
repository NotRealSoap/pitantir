import type { Job, JobsRepository } from "@pitantir/db";

export type JobHandler = (job: Job) => Promise<void>;

export interface WorkerLoopOptions {
  workerId: string;
  jobs: JobsRepository;
  handlers: Record<string, JobHandler>;
  leaseMs?: number;
  /** Called when a job type has no registered handler. */
  onUnknownJob?: (job: Job) => Promise<void>;
}

/**
 * Single-poll worker tick: claim one job, run its handler, complete or fail.
 * Heartbeat is available for long handlers via `jobs.heartbeat` inside the handler.
 */
export class WorkerLoop {
  private readonly workerId: string;
  private readonly jobs: JobsRepository;
  private readonly handlers: Record<string, JobHandler>;
  private readonly leaseMs: number;
  private readonly onUnknownJob: ((job: Job) => Promise<void>) | undefined;

  constructor(options: WorkerLoopOptions) {
    this.workerId = options.workerId;
    this.jobs = options.jobs;
    this.handlers = options.handlers;
    this.leaseMs = options.leaseMs ?? 60_000;
    this.onUnknownJob = options.onUnknownJob;
  }

  /** Process at most one job. Returns true if a job was claimed. */
  async tick(asOf?: Date): Promise<boolean> {
    const job = await this.jobs.claimNext(this.workerId, this.leaseMs, asOf);
    if (!job) {
      return false;
    }

    try {
      const handler = this.handlers[job.type];
      if (!handler) {
        if (this.onUnknownJob) {
          await this.onUnknownJob(job);
        } else {
          throw new Error(`No handler registered for job type: ${job.type}`);
        }
      } else {
        await handler(job);
      }
      const completed = await this.jobs.complete(job.id, this.workerId);
      if (!completed) {
        throw new Error(`Failed to complete job ${job.id}; lease may have been stolen`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.jobs.fail(job.id, this.workerId, message);
    }
    return true;
  }
}
