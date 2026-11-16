/**
 * Tashkent (Asia/Tashkent, GMT+5, no daylight saving) calendar maths, shared by the API's
 * reports and the web app's date filters.
 *
 * A "shifted" date is a UTC Date whose UTC fields read as Tashkent wall-clock time, so
 * `shiftToTashkent(d).getUTCDate()` is the Tashkent day of month.
 */
export const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant moved forward by five hours; read it with the `getUTC*` methods. */
export function shiftToTashkent(date: Date): Date {
  return new Date(date.getTime() + TASHKENT_OFFSET_MS);
}

/** The real instant of a Tashkent wall-clock time (month is 0-based, as in `Date.UTC`). */
export function fromTashkentLocalParts(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date {
  return new Date(Date.UTC(year, month, day, hour, minute, second, millisecond) - TASHKENT_OFFSET_MS);
}

/** `YYYY-MM-DD` of the Tashkent calendar day of an instant (`'NaN-NaN-NaN'` for an invalid date). */
export function toTashkentDateKey(date: Date): string {
  const shifted = shiftToTashkent(date);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/** Midnight UTC of the Tashkent calendar day of an instant (its UTC fields are that day). */
export function tashkentCalendarDay(date: Date): Date {
  const shifted = shiftToTashkent(date);

  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/** How reports label the Tashkent offset. */
export const TASHKENT_TIMEZONE_LABEL = 'GMT+5';
