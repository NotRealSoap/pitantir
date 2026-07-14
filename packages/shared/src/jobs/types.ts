export const JOB_STATUSES = ["pending", "leased", "done", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TYPES = [
  "scan_account",
  "process_scan",
  "apply_identity_decision",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export interface ScanAccountPayload {
  accountId: string;
  triggeredBy?: "schedule" | "manual" | "retry";
}

export interface ProcessScanPayload {
  scanId: string;
}
