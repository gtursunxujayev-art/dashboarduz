/**
 * Prefixes cell text that a spreadsheet would run as a formula (`=`, `+`, `-`, `@`, after optional
 * spaces) with `'`, so exported data cannot inject formulas. `null`/`undefined` become `''`.
 */
export function sanitizeSpreadsheetText(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}
