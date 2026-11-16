/**
 * Readers for loosely typed amoCRM API payloads (tasks, timestamps).
 */
import type { AmoCRMTask } from '../services/integrations/amocrm';

/** Trimmed string form of an id; `null`/`undefined` give `''` (but `0` gives `'0'`). */
export function toStringId(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

/** amoCRM sends seconds; values above 10^12 are already milliseconds. */
function toAmoMillis(value: number): number {
  return value > 1_000_000_000_000 ? value : value * 1000;
}

/** A timestamp in seconds, milliseconds, a numeric string or a date string; `null` when invalid. */
export function parseAmoTimestamp(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(toAmoMillis(value));

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'string') {
    const asNumber = Number(value);

    if (!Number.isNaN(asNumber)) {
      return parseAmoTimestamp(asNumber);
    }

    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

/**
 * The leads router's variant: unparseable values give the current time, and an out-of-range
 * number gives an Invalid Date instead of falling back (kept as it was; see the reuse report).
 */
export function parseAmoTimestampOrNow(value: unknown): Date {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(toAmoMillis(value));
  }

  if (typeof value === 'string') {
    const asNumber = Number(value);

    if (!Number.isNaN(asNumber)) {
      return parseAmoTimestampOrNow(asNumber);
    }

    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

/** `is_completed` / `completed` / `isCompleted` as a boolean (1, '1', 'true', 'yes', 'done' count as done). */
export function isCompletedTask(task: AmoCRMTask): boolean {
  const source = task as Record<string, unknown>;
  const value = task.is_completed ?? source.completed ?? source.isCompleted;

  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  const normalized = toStringId(value).toLowerCase();

  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'done';
}

/** Tasks without an entity type, or attached to leads. */
export function isLeadTask(task: AmoCRMTask): boolean {
  const entityType = toStringId(task.entity_type).toLowerCase();

  if (!entityType) {
    return true;
  }

  return entityType === 'lead' || entityType === 'leads';
}

/** `responsible_user_id`, else `responsible_user.id|user_id`, else `_embedded.responsible_user.id|user_id`, else `''`. */
export function taskResponsibleUserId(task: AmoCRMTask): string {
  const source = task as Record<string, unknown>;
  const direct = toStringId(task.responsible_user_id);

  if (direct) {
    return direct;
  }

  const nestedResponsible = source.responsible_user as Record<string, unknown> | undefined;
  const nestedEmbedded = (source._embedded as Record<string, unknown> | undefined)?.responsible_user as Record<string, unknown> | undefined;

  return (
    toStringId(nestedResponsible?.id)
    || toStringId(nestedResponsible?.user_id)
    || toStringId(nestedEmbedded?.id)
    || toStringId(nestedEmbedded?.user_id)
    || ''
  );
}
