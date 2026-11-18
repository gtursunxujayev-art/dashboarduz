/**
 * Tashkent calendar periods (day, Monday-based week, month) used by the amoCRM activity counters.
 * Each period runs from its first millisecond to its last, both inclusive.
 */
import { DAY_MS, fromTashkentLocalParts, shiftToTashkent } from '@dashboarduz/shared';

export type ActivityPeriod = { start: Date; end: Date };

export type ActivityRangeKind = 'today' | 'week' | 'month' | 'custom';

/** The period starting at `start` and lasting `lengthMs`. */
function periodFrom(start: Date, lengthMs: number): ActivityPeriod {
  return { start, end: new Date(start.getTime() + lengthMs - 1) };
}

export function getTashkentDayBounds(baseDate: Date): ActivityPeriod {
  const local = shiftToTashkent(baseDate);

  return periodFrom(fromTashkentLocalParts(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()), DAY_MS);
}

export function getTashkentWeekBounds(baseDate: Date): ActivityPeriod {
  const local = shiftToTashkent(baseDate);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;

  return periodFrom(
    fromTashkentLocalParts(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday),
    7 * DAY_MS,
  );
}

export function getTashkentMonthBounds(baseDate: Date): ActivityPeriod {
  const local = shiftToTashkent(baseDate);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();

  return {
    start: fromTashkentLocalParts(year, month, 1),
    end: new Date(fromTashkentLocalParts(year, month + 1, 1).getTime() - 1),
  };
}

/**
 * The window whose open tasks count as "due" follow-ups: this Tashkent week / month for those range
 * kinds, the requested range for a custom one, and today otherwise.
 */
export function getPeriodFollowUpBounds(
  rangeKind: ActivityRangeKind | undefined,
  rangeStart: Date,
  rangeEnd: Date,
  now: Date = new Date(),
): ActivityPeriod {
  if (rangeKind === 'week') {
    return getTashkentWeekBounds(now);
  }
  if (rangeKind === 'month') {
    return getTashkentMonthBounds(now);
  }
  if (rangeKind === 'custom') {
    return { start: rangeStart, end: rangeEnd };
  }

  return getTashkentDayBounds(now);
}
