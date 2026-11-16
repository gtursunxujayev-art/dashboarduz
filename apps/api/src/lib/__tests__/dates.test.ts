import {
  fromTashkentLocalParts,
  shiftToTashkent,
  tashkentCalendarDay,
  TASHKENT_OFFSET_MS,
  toTashkentDateKey,
} from '@dashboarduz/shared';

import { DATE_RANGE_MESSAGES_EN, getRangeStart, parseCustomDate, resolveDateRange, type DateRangeMessages } from '../dates';

describe('shared Tashkent date maths', () => {
  it('shifts by five hours and back', () => {
    const instant = new Date('2024-03-15T20:30:00.000Z');

    expect(shiftToTashkent(instant).toISOString()).toBe('2024-03-16T01:30:00.000Z');
    expect(fromTashkentLocalParts(2024, 2, 16, 1, 30).toISOString()).toBe(instant.toISOString());
    expect(fromTashkentLocalParts(2024, 0, 1).toISOString()).toBe('2023-12-31T19:00:00.000Z');
    expect(TASHKENT_OFFSET_MS).toBe(18_000_000);
  });

  it('formats the Tashkent calendar day (covers formatReportDate, formatLocalDate, toDateOnly, toLocalDateKey, getReportLocalDayKey)', () => {
    expect(toTashkentDateKey(new Date('2024-03-15T18:59:59.999Z'))).toBe('2024-03-15');
    expect(toTashkentDateKey(new Date('2024-03-15T19:00:00.000Z'))).toBe('2024-03-16');
    expect(tashkentCalendarDay(new Date('2024-03-15T19:00:00.000Z')).toISOString()).toBe('2024-03-16T00:00:00.000Z');
  });

  it('does not throw for an invalid date (the former toDateOnly copies used toISOString and threw)', () => {
    expect(toTashkentDateKey(new Date('nope'))).toBe('NaN-NaN-NaN');
  });
});

describe('getRangeStart', () => {
  const now = new Date('2024-03-15T10:00:00.000Z');

  it('supports last30days (sellers) as 29 days before today', () => {
    expect(getRangeStart('last30days', now).toISOString()).toBe('2024-02-14T19:00:00.000Z');
  });

  it('treats custom as month start', () => {
    expect(getRangeStart('custom', now).toISOString()).toBe('2024-02-29T19:00:00.000Z');
  });
});

describe('parseCustomDate', () => {
  it('rejects padded input unless trimInput is set (customer-income)', () => {
    expect(() => parseCustomDate(' 2024-03-15 ', false)).toThrow('Custom date must be in YYYY-MM-DD format.');
    expect(parseCustomDate(' 2024-03-15 ', true, { trimInput: true }).toISOString()).toBe('2024-03-15T18:59:59.999Z');
  });

  it('uses the given messages', () => {
    const messages: DateRangeMessages = {
      ...DATE_RANGE_MESSAGES_EN,
      invalidFormat: (input) => `Invalid date format: ${input}`,
      invalidDate: (input) => `Invalid date: ${input}`,
    };

    expect(() => parseCustomDate('15.03.2024', false, { messages })).toThrow('Invalid date format: 15.03.2024');
    expect(() => parseCustomDate('2024-13-45', false, { messages })).toThrow('Invalid date: 2024-13-45');
    expect(() => parseCustomDate('2024-13-45', false)).toThrow('Invalid custom date: 2024-13-45');
  });
});

describe('resolveDateRange messages (course-sales passes Uzbek ones)', () => {
  const uz: DateRangeMessages = {
    invalidFormat: () => "Sana formati YYYY-MM-DD bo'lishi kerak.",
    invalidDate: (input) => `Noto'g'ri sana: ${input}`,
    missingBounds: "Ixtiyoriy davr uchun 'dan' va 'gacha' sanalari majburiy.",
    endBeforeStart: "'gacha' sanasi 'dan' sanasidan oldin bo'lishi mumkin emas.",
  };
  const now = new Date('2024-03-15T10:00:00.000Z');

  it('reports missing and reversed bounds in the caller language', () => {
    expect(() => resolveDateRange('custom', now, undefined, '2024-03-01', uz)).toThrow(uz.missingBounds);
    expect(() => resolveDateRange('custom', now, '2024-03-02', '2024-03-01', uz)).toThrow(uz.endBeforeStart);
    expect(() => resolveDateRange('custom', now, 'x', '2024-03-01', uz)).toThrow("Sana formati YYYY-MM-DD bo'lishi kerak.");
    expect(() => resolveDateRange('custom', now, '2024-03-02', '2024-03-01')).toThrow(DATE_RANGE_MESSAGES_EN.endBeforeStart);
  });

  it('returns preset ranges ending now', () => {
    expect(resolveDateRange('today', now)).toEqual({ rangeStart: new Date('2024-03-14T19:00:00.000Z'), rangeEnd: now });
  });
});
