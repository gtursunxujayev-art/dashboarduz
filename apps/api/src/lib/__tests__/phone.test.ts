import { normalizeDigits } from '@dashboarduz/shared';

import { isLikelyExternalPhone, normalizePhoneKeepPlus } from '../phone';

describe('normalizeDigits (shared)', () => {
  it('keeps digits only', () => {
    expect(normalizeDigits('+998 (90) 123-45-67')).toBe('998901234567');
    expect(normalizeDigits(' 101 ')).toBe('101');
    expect(normalizeDigits(12345)).toBe('12345');
  });

  it('gives an empty string for falsy values, including the number 0', () => {
    // Two former copies (amocrm-call-sync, income-problems) used `?? ''` and returned '0' for the number 0.
    // Their callers only pass strings or null, so the merged `|| ''` behaviour is identical for them.
    expect(normalizeDigits(null)).toBe('');
    expect(normalizeDigits(undefined)).toBe('');
    expect(normalizeDigits('')).toBe('');
    expect(normalizeDigits(0)).toBe('');
  });

  it('covers the former sanitizeCustomerNumber (whitespace removal was redundant)', () => {
    expect(normalizeDigits(' 12 34\t56 ')).toBe('123456');
  });
});

describe('normalizePhoneKeepPlus', () => {
  it('keeps digits and plus signs', () => {
    expect(normalizePhoneKeepPlus('+998 (90) 123-45-67')).toBe('+998901234567');
    expect(normalizePhoneKeepPlus(null)).toBe('');
    expect(normalizePhoneKeepPlus('')).toBe('');
  });
});

describe('isLikelyExternalPhone', () => {
  it('needs at least 7 digits', () => {
    expect(isLikelyExternalPhone('+99890 1234567')).toBe(true);
    expect(isLikelyExternalPhone('123-4567')).toBe(true);
    expect(isLikelyExternalPhone('101')).toBe(false);
    expect(isLikelyExternalPhone(null)).toBe(false);
  });
});
