/**
 * Only the digits of a value: `'+998 (90) 123-45-67'` -> `'998901234567'`.
 * Falsy values (`null`, `undefined`, `''`, `0`) give `''`.
 *
 * Used for phone numbers, customer numbers and money inputs on both the API and the web app.
 */
export function normalizeDigits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}
