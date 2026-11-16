import { toFiniteNumber } from './object';

/** A percentage from loose input, clamped to 0..100 and rounded to 2 decimals. */
export function normalizePercentage(value: unknown): number {
  const parsed = toFiniteNumber(value, 0);

  if (parsed <= 0) {
    return 0;
  }
  if (parsed >= 100) {
    return 100;
  }

  return Number(parsed.toFixed(2));
}

/**
 * A computed percentage rounded to 2 decimals; non-finite or non-positive values give 0.
 * Unlike {@link normalizePercentage} it does not cap at 100 (a report may exceed its plan).
 */
export function roundPositivePercentage(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Number(value.toFixed(2));
}
