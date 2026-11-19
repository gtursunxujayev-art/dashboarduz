/**
 * Who may change which part of the bonus configuration. Admin changes everything; OnlineAdmin only the
 * online side: the `online` category rule, plans of the `online` category, course overrides of online
 * courses, fixed salaries of online-group users and adjustments of online agents. Company-wide parts
 * (base bonus mode, other categories, KPI, attendance penalties, month finalize / reconcile) stay Admin's;
 * an OnlineAdmin's changes to them are ignored or rejected.
 */
import { TRPCError } from '@trpc/server';

import type { FixedSalaryRow, SalaryBonusRules } from './types';

/** OnlineAdmin without Admin: limited to the online side of the bonus configuration. */
export function isOnlineScopedAdmin(roles: readonly string[]): boolean {
  return roles.includes('OnlineAdmin') && !roles.includes('Admin');
}

function forbidden(message: string): never {
  throw new TRPCError({ code: 'FORBIDDEN', message });
}

/** Rejects a plan category an OnlineAdmin may not create or change. */
export function assertOnlinePlanCategory(category: string | null | undefined): void {
  if (category !== 'online') {
    forbidden('OnlineAdmin can only manage plans of the online category.');
  }
}

/**
 * The bonus rules an OnlineAdmin's save results in: the requested `online` rule; every other category
 * and the base bonus mode stay as they are (changes to them in the request are ignored).
 */
export function restrictBonusRulesToOnline<Mode extends string>(params: {
  current: { bonusMode: Mode; bonusRules: SalaryBonusRules };
  requested: { bonusMode: Mode; bonusRules: SalaryBonusRules };
}): { bonusMode: Mode; bonusRules: SalaryBonusRules } {
  const { current, requested } = params;

  return { bonusMode: current.bonusMode, bonusRules: { ...current.bonusRules, online: requested.bonusRules.online } };
}

/**
 * Course overrides after an OnlineAdmin's save: the requested overrides of online courses (added,
 * changed or removed), the current ones of every other course.
 */
export function restrictCourseOverridesToOnline<T>(params: {
  current: Record<string, T>;
  requested: Record<string, T>;
  onlineCourseIds: ReadonlySet<string>;
}): Record<string, T> {
  const { current, requested, onlineCourseIds } = params;
  const next: Record<string, T> = {};

  for (const [courseId, override] of Object.entries(current)) {
    if (!onlineCourseIds.has(courseId)) next[courseId] = override;
  }
  for (const [courseId, override] of Object.entries(requested)) {
    if (onlineCourseIds.has(courseId)) next[courseId] = override;
  }

  return next;
}

/**
 * Fixed salaries after a save limited to `allowedUserIds`: the requested rows of those users, the
 * current rows of everyone else (whom the caller neither sees nor may change).
 */
export function mergeFixedSalariesForUsers(params: {
  current: readonly FixedSalaryRow[];
  requested: readonly FixedSalaryRow[];
  allowedUserIds: readonly string[];
}): FixedSalaryRow[] {
  const allowed = new Set(params.allowedUserIds);

  return [
    ...params.current.filter((row) => !allowed.has(row.userId)),
    ...params.requested.filter((row) => allowed.has(row.userId)),
  ];
}

/** A bonus month calculation limited to some agents (`null` = all), its total recomputed from their lines. */
export function limitBonusResultToUsers<R extends { totalBonusAmount: number; lines: Array<{ agentUserId: string; bonusAmount: number }>; items: Array<{ agentUserId: string }> }>(
  result: R,
  userIds: readonly string[] | null,
): R {
  if (userIds === null) return result;
  const allowed = new Set(userIds);
  const lines = result.lines.filter((line) => allowed.has(line.agentUserId));

  return {
    ...result,
    lines,
    items: result.items.filter((item) => allowed.has(item.agentUserId)),
    totalBonusAmount: lines.reduce((sum, line) => sum + line.bonusAmount, 0),
  };
}
