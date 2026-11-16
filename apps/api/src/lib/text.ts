/**
 * Text normalisation for matching names and keys across imports, spreadsheets and the database.
 */

export type MatchTextOptions = {
  /** Collapse runs of whitespace to one space. */
  collapseWhitespace?: boolean;
  /** Turn the typographic apostrophe ’ into '. */
  unifyApostrophes?: boolean;
  /** Turn hyphens into spaces (after collapsing, so "a - b" becomes "a   b"). */
  hyphensToSpaces?: boolean;
};

/** Trimmed, lower-cased text, with the optional extra normalisation steps applied in the order listed. */
export function normalizeMatchText(value: unknown, options: MatchTextOptions = {}): string {
  let text = String(value ?? '').trim().toLowerCase();

  if (options.collapseWhitespace) text = text.replace(/\s+/g, ' ');
  if (options.unifyApostrophes) text = text.replace(/[’']/g, "'");
  if (options.hyphensToSpaces) text = text.replace(/-/g, ' ');

  return text;
}

/** Lower-case ASCII letters and digits only (quotes dropped): `"O'Brien Ltd."` -> `'obrienltd'`. */
export function normalizeKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/['"`’]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}
