/**
 * UTEL (VoIP) call helpers: manager extensions, call direction and talk duration.
 */
import { normalizeDigits } from '@dashboarduz/shared';

import { asObject, getCaseInsensitiveValue } from './object';

/** Manager extensions on the UTEL PBX are 100-150; anything else is a customer number or a trunk. */
export const UTEL_MIN_EXTENSION = 100;
export const UTEL_MAX_EXTENSION = 150;

export function isAllowedUtelManagerExtension(value: unknown): boolean {
  const digits = normalizeDigits(value);

  if (!digits) {
    return false;
  }
  const parsed = Number.parseInt(digits, 10);

  return Number.isFinite(parsed) && parsed >= UTEL_MIN_EXTENSION && parsed <= UTEL_MAX_EXTENSION;
}

export type UtelCallParties = { from: string; to: string };
export type UtelCallForExtension = UtelCallParties & { direction: string; metadata: unknown };

/**
 * The manager extension of a call: first the extension recorded in metadata
 * (`normalized_extension`, `extension`, `ext`, `internal`, `line`), then the party on the
 * manager's side for the call direction (outbound: `from`, inbound: `to`), then either party.
 */
export function resolveCallExtension(call: UtelCallForExtension): string | null {
  const metadata = asObject(call.metadata);
  const metadataExtension = normalizeDigits(
    metadata?.normalized_extension
    || metadata?.extension
    || metadata?.ext
    || metadata?.internal
    || metadata?.line,
  );

  if (isAllowedUtelManagerExtension(metadataExtension)) {
    return metadataExtension;
  }

  const fromDigits = normalizeDigits(call.from);
  const toDigits = normalizeDigits(call.to);
  const direction = String(call.direction || '').toLowerCase();

  if (direction === 'outbound') {
    if (isAllowedUtelManagerExtension(fromDigits)) return fromDigits;
    if (isAllowedUtelManagerExtension(toDigits)) return toDigits;
  }

  if (direction === 'inbound') {
    if (isAllowedUtelManagerExtension(toDigits)) return toDigits;
    if (isAllowedUtelManagerExtension(fromDigits)) return fromDigits;
  }

  return resolveExtensionFromCallParties({ from: fromDigits, to: toDigits });
}

/**
 * The manager extension from the call parties only (`from`, then `to`), ignoring metadata and direction.
 * Used by the sellers report; {@link resolveCallExtension} is the fuller lookup.
 */
export function resolveExtensionFromCallParties(call: UtelCallParties): string | null {
  const fromExtension = normalizeDigits(call.from);

  if (isAllowedUtelManagerExtension(fromExtension)) {
    return fromExtension;
  }
  const toExtension = normalizeDigits(call.to);

  if (isAllowedUtelManagerExtension(toExtension)) {
    return toExtension;
  }

  return null;
}

/** Whole non-negative seconds from a number or a numeric string, else `null`. */
export function parseCallDuration(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);

    return Number.isNaN(parsed) ? null : Math.max(0, parsed);
  }

  return null;
}

const DURATION_KEYS = ['normalized_duration', 'duration', 'billsec', 'conversation', 'talk_duration'];

/** The stored duration when present, else the first duration found in the metadata or its `raw_call_history`. */
export function resolveCallDuration(duration: number | null, metadata: unknown): number {
  if (duration !== null && duration !== undefined) {
    return Math.max(0, duration);
  }

  const metadataObject = asObject(metadata);

  if (!metadataObject) {
    return 0;
  }

  const candidates = [metadataObject];
  const rawHistory = asObject(metadataObject.raw_call_history);

  if (rawHistory) {
    candidates.push(rawHistory);
  }

  for (const candidate of candidates) {
    for (const key of DURATION_KEYS) {
      const parsed = parseCallDuration(getCaseInsensitiveValue(candidate, key));

      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return 0;
}

/** `'out'`, `'outbound'`, `'dial_out'` and `'outgoing'` (any case) are outbound; everything else is inbound. */
export function normalizeCallDirection(value: unknown): 'inbound' | 'outbound' {
  const normalized = String(value || '').trim().toLowerCase();

  if (['out', 'outbound', 'dial_out', 'outgoing'].includes(normalized)) {
    return 'outbound';
  }

  return 'inbound';
}
