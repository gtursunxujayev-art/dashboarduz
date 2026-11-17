// How much amoCRM history the database snapshot keeps. 62 days covers every preset filter
// (today, this/last week, this/last month). A range that starts earlier is read from amoCRM live.
export const SNAPSHOT_WINDOW_DAYS = 62;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Oldest moment the snapshot holds. */
export function snapshotCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - SNAPSHOT_WINDOW_DAYS * DAY_MS);
}

/**
 * Whether a query starting at `rangeStart` can be answered from the snapshot: it must start inside
 * the window, and the snapshot must have finished its first fill (`ready`) so nothing shows a
 * half-filled picture. A query without a start (open-ended back in time) needs amoCRM.
 */
export function isRangeInSnapshot(rangeStart: Date | null | undefined, ready: boolean, now: Date = new Date()): boolean {
  if (!ready || !rangeStart) return false;

  return rangeStart.getTime() >= snapshotCutoff(now).getTime();
}
