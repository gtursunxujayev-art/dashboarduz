import { normalizeDigits } from '@dashboarduz/shared';

/** Digits and `+` only (keeps an international prefix): `'+998 90-123'` -> `'+99890123'`. Falsy gives `''`. */
export function normalizePhoneKeepPlus(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  return value.replace(/[^\d+]/g, '');
}

/** True when the value holds at least 7 digits, i.e. looks like a customer phone rather than a short internal number. */
export function isLikelyExternalPhone(value: string | null | undefined): boolean {
  return normalizeDigits(value).length >= 7;
}
