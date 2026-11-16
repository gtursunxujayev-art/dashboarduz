export const AGENT_ROLES = new Set(['Agent', 'OnlineAgent', 'OfflineAgent']);

export function getTodayTashkentDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function getNowTashkentDateTimeLocal(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function formatSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hh = Math.floor(safe / 3600);
  const mm = Math.floor((safe % 3600) / 60);
  const ss = safe % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function formatSecondsOrDash(totalSeconds: number | null | undefined): string {
  if (typeof totalSeconds !== 'number') return '-';
  return formatSeconds(totalSeconds);
}

export function hasInPresence(row: any): boolean {
  if (!row) return false;
  if (row.firstInAt) return true;
  return typeof row.inCount === 'number' && row.inCount > 0;
}

export function getPresenceLabel(row: any): string {
  return hasInPresence(row) ? 'Kelgan (IN bor)' : "Kelmagan (IN yo'q)";
}
