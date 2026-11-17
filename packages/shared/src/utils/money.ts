/**
 * Number and money formatting shared by the API (Telegram reports) and the web app.
 *
 * The copies this replaced disagreed on locale, rounding, unit and how they treat `null`/`NaN`;
 * every difference is an explicit option here so each caller keeps its exact output.
 */
export type AmountFormatOptions = {
  /** Grouping style: `ru-RU` and `uz-UZ` group with a no-break space, `en-US` with a comma. */
  locale: 'ru-RU' | 'uz-UZ' | 'en-US';
  /** Appended after a space, e.g. `so'm` or `UZS`. */
  unit?: string;
  /** Round to a whole number first. */
  round?: boolean;
  /** Show negative amounts as 0. */
  clampNegative?: boolean;
  /**
   * How missing values become numbers: `'nullish'` maps only `null`/`undefined` to 0 (so `NaN`
   * prints as "NaN"); `'falsy'` also maps `NaN` to 0.
   */
  missing?: 'nullish' | 'falsy';
};

export function formatAmount(value: number | null | undefined, options: AmountFormatOptions): string {
  let amount = options.missing === 'falsy' ? Number(value || 0) : (value ?? 0);

  if (options.round) amount = Math.round(amount);
  if (options.clampNegative) amount = Math.max(0, amount);

  const text = new Intl.NumberFormat(options.locale).format(amount);

  return options.unit ? `${text} ${options.unit}` : text;
}

/** Thousands separators inside a digit string: `'1234567'` -> `'1,234,567'` (empty stays empty). */
export function groupDigits(value: string, separator = ','): string {
  if (!value) return '';

  return value.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/**
 * The one money format for API output (Telegram reports, payment/refund/tariff notifications, AI hints):
 * whole so'm, digits grouped with plain spaces, e.g. `1 234 567 so'm`. Missing or non-finite values are 0;
 * negative amounts keep their sign (`-5 000 so'm`).
 */
export function formatSomAmount(value: number | null | undefined): string {
  const amount = Math.round(Number.isFinite(value) ? Number(value) : 0);
  const sign = amount < 0 ? '-' : '';

  return `${sign}${groupDigits(String(Math.abs(amount)), ' ')} so'm`;
}
