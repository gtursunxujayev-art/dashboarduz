/**
 * The one duration format of the API: Telegram messages, PDF reports and corporate-call rows.
 */

/**
 * `HH:MM:SS` (hours keep growing past 99), or `HH:MM` with `withSeconds: false` for narrow report columns.
 * Negative, missing or non-finite values count as 0; fractions of a second are dropped.
 */
export function formatDuration(totalSeconds: number | null | undefined, options: { withSeconds?: boolean } = {}): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? Number(totalSeconds) : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const parts = [hours, minutes, ...(options.withSeconds === false ? [] : [seconds])];

  return parts.map((part) => String(part).padStart(2, '0')).join(':');
}
