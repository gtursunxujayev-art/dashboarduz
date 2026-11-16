/** Telegram usernames keep letters, digits, `_` and `@` only. */
export function sanitizeTelegramUsername(value: string): string {
  return String(value || '').replace(/\s+/g, '').replace(/[^A-Za-z0-9_@]/g, '');
}

/** Sub-tariff names are compared trimmed and lower-cased. */
export function normalizeSubTariffName(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}
