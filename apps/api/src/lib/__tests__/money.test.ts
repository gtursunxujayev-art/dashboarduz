import { formatAmount, formatSomAmount, groupDigits } from '@dashboarduz/shared';

const NBSP = ' ';

describe('formatAmount (shared)', () => {
  it('formats like the agent performance report (ru-RU, rounded, never negative, so\'m)', () => {
    const options = { locale: 'ru-RU', unit: "so'm", round: true, clampNegative: true } as const;

    expect(formatAmount(1234567.6, options)).toBe(`1${NBSP}234${NBSP}568 so'm`);
    expect(formatAmount(-5, options)).toBe("0 so'm");
  });

  it('formats like the daily report (en-US, rounded, UZS, negatives kept)', () => {
    const options = { locale: 'en-US', unit: 'UZS', round: true } as const;

    expect(formatAmount(1234567.4, options)).toBe('1,234,567 UZS');
    expect(formatAmount(-1500, options)).toBe('-1,500 UZS');
  });

  it('keeps fractions unless rounding, and treats missing values per option', () => {
    expect(formatAmount(1500.25, { locale: 'ru-RU', unit: "so'm" })).toBe(`1${NBSP}500,25 so'm`);
    expect(formatAmount(null, { locale: 'ru-RU' })).toBe('0');
    expect(formatAmount(Number.NaN, { locale: 'ru-RU' })).toBe(new Intl.NumberFormat('ru-RU').format(Number.NaN));
    expect(formatAmount(Number.NaN, { locale: 'ru-RU', missing: 'falsy' })).toBe('0');
    expect(formatAmount(1234.5, { locale: 'uz-UZ', round: true, missing: 'falsy', unit: "so'm" })).toBe(`1${NBSP}235 so'm`);
  });
});

describe('groupDigits', () => {
  it('adds comma separators', () => {
    expect(groupDigits('1234567')).toBe('1,234,567');
    expect(groupDigits('1234.5')).toBe('1,234.5');
    expect(groupDigits('')).toBe('');
  });
});

describe('formatSomAmount (the one API money format)', () => {
  it('rounds to whole som and groups with plain spaces', () => {
    expect(formatSomAmount(1234567)).toBe("1 234 567 so'm");
    expect(formatSomAmount(1234567.6)).toBe("1 234 568 so'm");
    expect(formatSomAmount(999)).toBe("999 so'm");
    expect(formatSomAmount(0)).toBe("0 so'm");
  });

  it('keeps the sign and maps missing values to 0', () => {
    expect(formatSomAmount(-5000)).toBe("-5 000 so'm");
    expect(formatSomAmount(-0.4)).toBe("0 so'm");
    expect(formatSomAmount(null)).toBe("0 so'm");
    expect(formatSomAmount(undefined)).toBe("0 so'm");
    expect(formatSomAmount(Number.NaN)).toBe("0 so'm");
  });
});
