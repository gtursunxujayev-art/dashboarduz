/**
 * Display formatting for dashboard pages: money, numbers, percentages, durations and dates.
 *
 * Pages used to carry their own copies of these, and the copies disagree (locale, rounding,
 * unit, empty-value text). Each distinct behaviour has its own function or option here, and
 * every page keeps the output it had; `lib/format.test.ts` pins them. Where two of them print
 * the same thing today, the reuse report lists them as candidates to merge.
 */
import { formatAmount, groupDigits, normalizeDigits } from '@dashboarduz/shared';

const TASHKENT_TIME_ZONE = 'Asia/Tashkent';

// ---------------------------------------------------------------------------------------------
// Money

/** `1 234 567,5 so'm` (ru-RU grouping, fractions kept, `null` -> 0). Most dashboard pages. */
export function formatSom(value: number | null | undefined): string {
  return formatAmount(value, { locale: 'ru-RU', unit: "so'm" });
}

/** `1 234 568 so'm` (ru-RU grouping, rounded, `null`/`NaN` -> 0). Funnel and sellers pages. */
export function formatSomRounded(value: number | null | undefined): string {
  return formatAmount(value, { locale: 'ru-RU', unit: "so'm", round: true, missing: 'falsy' });
}

/** `1 234 568 so'm` with uz-UZ grouping (rounded, `null`/`NaN` -> 0). Reports, income debug, analytics, leaderboard. */
export function formatSomUz(value: number | null | undefined): string {
  return formatAmount(value, { locale: 'uz-UZ', unit: "so'm", round: true, missing: 'falsy' });
}

/** `1 234 567,5 UZS` (ru-RU grouping, fractions kept, `null` -> 0). Bonus plans page. */
export function formatUzs(value: number | null | undefined): string {
  return formatAmount(value, { locale: 'ru-RU', unit: 'UZS' });
}

/** `1,234,567` (en-US grouping, no unit). Customers page. */
export function formatNumberEn(value: number): string {
  return formatAmount(value, { locale: 'en-US' });
}

/** `1,234,567` from the raw digits, negatives shown as 0, `null` -> `'0'`. Income and adjustment forms. */
export function formatAmountDigits(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0';
  return groupDigits(String(Math.max(0, value)));
}

/** `1.2B`, `3.4M`, `56K` or the rounded number. */
export function formatCompactMoney(amount: number): string {
  const value = Math.round(amount || 0);
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

/** The whole number typed into an amount input (`'1,250,000 so'm'` -> 1250000); empty gives 0. */
export function parseAmountInput(value: string): number {
  const digits = normalizeDigits(value);
  if (!digits) return 0;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ---------------------------------------------------------------------------------------------
// Percentages

/** `12.3%` with the given number of decimals; `null`/`undefined` -> `'-'`. */
export function formatPercent(value: number | null | undefined, fractionDigits: number): string {
  if (value === null || value === undefined) return '-';
  return `${Number(value).toFixed(fractionDigits)}%`;
}

// ---------------------------------------------------------------------------------------------
// Durations

function splitDuration(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return {
    hours: Math.floor(safe / 3600),
    minutes: Math.floor((safe % 3600) / 60),
    seconds: safe % 60,
  };
}

const pad2 = (value: number) => String(value).padStart(2, '0');

/**
 * `HH:MM:SS`. Missing values print `missingText` when given (analytics charts use `'-'`),
 * otherwise they count as 0 (seller details, leaderboard).
 */
export function formatDurationClock(seconds: number | null | undefined, missingText?: string): string {
  if ((seconds === null || seconds === undefined) && missingText !== undefined) return missingText;
  const { hours, minutes, seconds: secs } = splitDuration(seconds || 0);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}`;
}

/** `1 soat 2 daq 3 son` (calls page); missing counts as 0. */
export function formatDurationShortWords(seconds: number | null | undefined): string {
  const parts = splitDuration(seconds || 0);
  return `${parts.hours} soat ${parts.minutes} daq ${parts.seconds} son`;
}

/** `1 soat 2 daqiqa 3 soniya` (dashboard home); missing prints `'-'`. */
export function formatDurationLongWords(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '-';
  const parts = splitDuration(seconds);
  return `${parts.hours} soat ${parts.minutes} daqiqa ${parts.seconds} soniya`;
}

/** The two largest non-zero units: `1 soat 2 daqiqa`, `2 daqiqa 3 soniya` or `3 soniya` (sellers list). */
export function formatDurationCompact(seconds: number | null | undefined): string {
  const parts = splitDuration(seconds || 0);
  if (parts.hours > 0) return `${parts.hours} soat ${parts.minutes} daqiqa`;
  if (parts.minutes > 0) return `${parts.minutes} daqiqa ${parts.seconds} soniya`;
  return `${parts.seconds} soniya`;
}

/** `1 soat 2 daqiqa` (always both units); missing prints `'-'` (dashboard talk time). */
export function formatDurationHoursMinutes(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '-';
  const parts = splitDuration(seconds);
  return `${parts.hours} soat ${parts.minutes} daqiqa`;
}

/** Lead response time: `45 son`, `5 daq`, `1 soat 30 daq`; zero or less -> `'-'`. */
export function formatResponseTime(seconds: number): string {
  if (seconds <= 0) return '-';
  if (seconds < 60) return `${seconds} son`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} daq`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h} soat ${m} daq`;
}

// ---------------------------------------------------------------------------------------------
// Dates

type DateInput = Date | string | null | undefined;

function toValidDate(value: DateInput): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `YYYY-MM-DD` in Tashkent; missing or invalid -> `emptyText` (`'-'` on pages, `''` in exports). */
export function formatTashkentDate(value: DateInput, emptyText = '-'): string {
  const date = toValidDate(value);
  return date ? date.toLocaleDateString('en-CA', { timeZone: TASHKENT_TIME_ZONE }) : emptyText;
}

/** `YYYY-MM-DD HH:mm` (or with `:ss`) in Tashkent for spreadsheet exports; missing or invalid -> `''`. */
export function formatTashkentTimestamp(value: DateInput, options: { withSeconds: boolean }): string {
  const date = toValidDate(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TASHKENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(options.withSeconds ? { second: '2-digit' as const } : {}),
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const time = `${get('hour')}:${get('minute')}${options.withSeconds ? `:${get('second')}` : ''}`;
  return `${get('year')}-${get('month')}-${get('day')} ${time}`;
}

export type DateTimeFormatOptions = {
  /** `undefined` uses the browser's locale. */
  locale?: string;
  /** `undefined` uses the browser's time zone. */
  timeZone?: string;
  /** Text for `null`/`undefined`/`''`; when not set, those go to `new Date()` as before. */
  emptyText?: string;
  /** Text for an unparseable value; when not set, the browser prints "Invalid Date". */
  invalidText?: string;
};

/** A date and time via `toLocaleString`, with each page's choice of locale, zone and empty text. */
export function formatDateTime(value: Date | string | null | undefined, options: DateTimeFormatOptions = {}): string {
  if (!value && options.emptyText !== undefined) return options.emptyText;
  const date = new Date(value as Date | string);
  if (options.invalidText !== undefined && Number.isNaN(date.getTime())) return options.invalidText;
  return date.toLocaleString(options.locale, options.timeZone ? { timeZone: options.timeZone } : undefined);
}

/** Uzbek date and time in Tashkent (attendance, corporate calls, lead details add their empty/invalid text). */
export const UZ_TASHKENT_DATE_TIME: DateTimeFormatOptions = { locale: 'uz-UZ', timeZone: TASHKENT_TIME_ZONE };

// ---------------------------------------------------------------------------------------------
// Labels

/** Non-empty parts joined with `' / '`, or `'-'`: `formatCourseBundle('IELTS', 'Pro')` -> `'IELTS / Pro'`. */
export function formatCourseBundle(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' / ') || '-';
}
