import { describe, expect, it } from '@jest/globals';
import {
  formatAmountDigits,
  formatCompactMoney,
  formatCourseBundle,
  formatDateTime,
  formatDurationClock,
  formatDurationCompact,
  formatDurationHoursMinutes,
  formatDurationLongWords,
  formatDurationShortWords,
  formatNumberEn,
  formatPercent,
  formatResponseTime,
  formatSom,
  formatSomRounded,
  formatSomUz,
  formatTashkentDate,
  formatTashkentTimestamp,
  formatUzs,
  parseAmountInput,
  UZ_TASHKENT_DATE_TIME,
} from './format';

// Expected strings are built with Intl so the tests pin the behaviour (rounding, unit, empty handling)
// rather than the ICU version's separator characters.
const ru = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
const uz = (value: number) => new Intl.NumberFormat('uz-UZ').format(value);

describe('money formatters (one per former behaviour)', () => {
  it("formatSom: ru-RU, fractions kept, null -> 0 (9 former copies)", () => {
    expect(formatSom(1234567.5)).toBe(`${ru(1234567.5)} so'm`);
    expect(formatSom(null)).toBe("0 so'm");
    expect(formatSom(undefined)).toBe("0 so'm");
  });

  it("formatSomRounded: ru-RU, rounded, NaN -> 0 (funnel, sellers)", () => {
    expect(formatSomRounded(1234567.5)).toBe(`${ru(1234568)} so'm`);
    expect(formatSomRounded(Number.NaN)).toBe("0 so'm");
    expect(formatSomRounded(null)).toBe("0 so'm");
  });

  it("formatSomUz: uz-UZ, rounded, NaN -> 0 (reports, income debug, analytics, leaderboard)", () => {
    expect(formatSomUz(1234567.4)).toBe(`${uz(1234567)} so'm`);
    expect(formatSomUz(Number.NaN)).toBe("0 so'm");
  });

  it('formatUzs: ru-RU, fractions kept, UZS (bonus page)', () => {
    expect(formatUzs(1500.25)).toBe(`${ru(1500.25)} UZS`);
    expect(formatUzs(null)).toBe('0 UZS');
  });

  it('formatNumberEn: en-US commas, no unit (customers page)', () => {
    expect(formatNumberEn(1234567)).toBe('1,234,567');
  });

  it("formatAmountDigits: comma groups on the raw number, negatives -> 0, null -> '0' (income, adjustments)", () => {
    expect(formatAmountDigits(1234567)).toBe('1,234,567');
    expect(formatAmountDigits(-5)).toBe('0');
    expect(formatAmountDigits(null)).toBe('0');
  });

  it('formatCompactMoney', () => {
    expect(formatCompactMoney(2_345_678_901)).toBe('2.3B');
    expect(formatCompactMoney(3_450_000)).toBe('3.5M');
    expect(formatCompactMoney(56_400)).toBe('56K');
    expect(formatCompactMoney(999.6)).toBe('1K');
    expect(formatCompactMoney(999.4)).toBe('999');
  });

  it('parseAmountInput', () => {
    expect(parseAmountInput("1,250,000 so'm")).toBe(1250000);
    expect(parseAmountInput('')).toBe(0);
    expect(parseAmountInput('9'.repeat(400))).toBe(0);
  });
});

describe('formatPercent', () => {
  it('uses the caller precision (1 on seller pages, 2 on analytics charts)', () => {
    expect(formatPercent(12.345, 1)).toBe('12.3%');
    expect(formatPercent(12.345, 2)).toBe('12.35%');
    expect(formatPercent(null, 1)).toBe('-');
  });
});

describe('duration formatters', () => {
  it('clock: missing counts as 0 unless a missing text is given', () => {
    expect(formatDurationClock(3725)).toBe('01:02:05');
    expect(formatDurationClock(null)).toBe('00:00:00');
    expect(formatDurationClock(null, '-')).toBe('-');
    expect(formatDurationClock(-4, '-')).toBe('00:00:00');
  });

  it('words: short (calls), long (dashboard, missing -> -), compact (sellers)', () => {
    expect(formatDurationShortWords(3725)).toBe('1 soat 2 daq 5 son');
    expect(formatDurationShortWords(null)).toBe('0 soat 0 daq 0 son');
    expect(formatDurationLongWords(3725)).toBe('1 s 2 d 5 s');
    expect(formatDurationLongWords(undefined)).toBe('-');
    expect(formatDurationCompact(3725)).toBe('1 soat 2 daqiqa');
    expect(formatDurationCompact(125)).toBe('2 daqiqa 5 soniya');
    expect(formatDurationCompact(5)).toBe('5 soniya');
    expect(formatDurationHoursMinutes(3725)).toBe('1 soat 2 daqiqa');
    expect(formatDurationHoursMinutes(null)).toBe('-');
  });

  it('response time', () => {
    expect(formatResponseTime(0)).toBe('-');
    expect(formatResponseTime(45)).toBe('45 son');
    expect(formatResponseTime(300)).toBe('5 daq');
    expect(formatResponseTime(5400)).toBe('1 soat 30 daq');
  });
});

describe('date formatters', () => {
  const instant = '2026-07-31T20:30:05.000Z'; // 2026-08-01 01:30:05 in Tashkent

  it('formatTashkentDate: Tashkent day, empty text per caller', () => {
    expect(formatTashkentDate(instant)).toBe('2026-08-01');
    expect(formatTashkentDate(new Date(instant))).toBe('2026-08-01');
    expect(formatTashkentDate(null)).toBe('-');
    expect(formatTashkentDate('nope', '')).toBe('');
  });

  it('formatTashkentTimestamp: minutes for reports, seconds for attendance', () => {
    expect(formatTashkentTimestamp(instant, { withSeconds: false })).toBe('2026-08-01 01:30');
    expect(formatTashkentTimestamp(instant, { withSeconds: true })).toBe('2026-08-01 01:30:05');
    expect(formatTashkentTimestamp(null, { withSeconds: true })).toBe('');
  });

  it('formatDateTime keeps each page choice of locale, zone, empty and invalid text', () => {
    const uzTashkent = new Date(instant).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });

    expect(formatDateTime(instant, UZ_TASHKENT_DATE_TIME)).toBe(uzTashkent);
    expect(formatDateTime(null, { ...UZ_TASHKENT_DATE_TIME, emptyText: '-' })).toBe('-');
    expect(formatDateTime('nope', { ...UZ_TASHKENT_DATE_TIME, emptyText: '-', invalidText: '-' })).toBe('-');
    expect(formatDateTime('nope', { ...UZ_TASHKENT_DATE_TIME, emptyText: '-' })).toBe('Invalid Date');
    expect(formatDateTime(instant, { locale: 'uz-UZ' })).toBe(new Date(instant).toLocaleString('uz-UZ'));
    expect(formatDateTime(undefined, { emptyText: '—' })).toBe('—');
    expect(formatDateTime(instant, { emptyText: '—' })).toBe(new Date(instant).toLocaleString());
  });
});

describe('formatCourseBundle', () => {
  it('joins the non-empty parts', () => {
    expect(formatCourseBundle('IELTS', null, 'VIP')).toBe('IELTS / VIP');
    expect(formatCourseBundle('IELTS', 'Pro')).toBe('IELTS / Pro');
    expect(formatCourseBundle(null, undefined)).toBe('-');
  });
});
