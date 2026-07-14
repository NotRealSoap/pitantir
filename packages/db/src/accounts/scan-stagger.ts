/**
 * Spread watch-list nextScanAt times evenly across one interval window so the
 * worker does not enqueue every account in a single burst.
 *
 * - mode "rebalance": i=0 due immediately, others spaced through the window
 * - mode "after_burst": after a due-burst enqueue, schedule the next wave with
 *   spacing (interval/count) so the cluster does not reform at `now + interval`
 */
export function staggeredNextScanAts(input: {
  count: number;
  intervalSeconds: number;
  from?: Date;
  mode?: "rebalance" | "after_burst";
}): Date[] {
  const count = Math.max(0, Math.floor(input.count));
  const intervalMs = Math.max(30, Math.floor(input.intervalSeconds)) * 1000;
  const from = input.from ?? new Date();
  const mode = input.mode ?? "rebalance";
  if (count === 0) return [];
  if (count === 1) {
    const offset = mode === "after_burst" ? intervalMs : Math.min(5_000, intervalMs);
    return [new Date(from.getTime() + offset)];
  }

  const out: Date[] = [];
  for (let i = 0; i < count; i += 1) {
    const slot = mode === "after_burst" ? i + 1 : i;
    const offset = Math.round((slot * intervalMs) / count);
    out.push(new Date(from.getTime() + offset));
  }
  return out;
}
