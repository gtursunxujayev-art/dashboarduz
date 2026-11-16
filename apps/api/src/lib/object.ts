/**
 * Helpers for reading loosely typed values (JSON columns, webhook payloads, env-derived config).
 *
 * Several call sites used to carry their own copy of these. Where the copies behaved differently,
 * each behaviour has its own name here; see the tests in `__tests__/object.test.ts`.
 */

/** A plain (non-array) object, or `null` for anything else. */
export function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

/** Like {@link asObject}, but an empty object instead of `null`. */
export function asObjectOrEmpty(value: unknown): Record<string, unknown> {
  return asObject(value) ?? {};
}

/** `source[key]`, falling back to the first key that matches ignoring case. */
export function getCaseInsensitiveValue(source: Record<string, unknown>, key: string): unknown {
  if (key in source) {
    return source[key];
  }
  const normalizedKey = key.toLowerCase();

  for (const [entryKey, entryValue] of Object.entries(source)) {
    if (entryKey.toLowerCase() === normalizedKey) {
      return entryValue;
    }
  }

  return undefined;
}

/** Finite numbers pass through; strings are parsed with `parseFloat`; anything else is `fallback`. */
export function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());

    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

/** `Number(value)` when finite, else `null` (so `''` and `null` give `0`, `'12abc'` gives `null`). */
export function toNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

/** `parseFloat(String(value ?? '0'))` when finite, else `0` (so `'12abc'` gives `12`). */
export function parseFloatOrZero(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? '0'));

  return Number.isFinite(parsed) ? parsed : 0;
}

/** A trimmed string, or `null` when the value is not a string or is blank. */
export function trimmedStringOrNull(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';

  return normalized || null;
}

/** A trimmed string, or `''` when the value is not a string. */
export function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const PREFERRED_TEXT_KEYS = ['name', 'title', 'label', 'value', 'status', 'state', 'code', 'text'];

/**
 * Text out of a webhook-style value: trimmed strings, numbers and booleans as strings, and for
 * plain objects the first non-empty of `name`, `title`, `label`, `value`, `status`, `state`, `code`, `text`.
 * Blank and unsupported values give `null`.
 */
export function textFromUnknown(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();

    return normalized || null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    const objectValue = value as Record<string, unknown>;

    for (const key of PREFERRED_TEXT_KEYS) {
      const nested = textFromUnknown(objectValue[key]);

      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

/** {@link textFromUnknown}, with `''` instead of `null`. */
export function textFromUnknownOrEmpty(value: unknown): string {
  return textFromUnknown(value) ?? '';
}

/**
 * Stricter than {@link textFromUnknown}: only non-blank strings (trimmed) and finite numbers.
 * Booleans, `NaN`/`Infinity` and objects give `null`.
 */
export function textFromScalar(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();

    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}
