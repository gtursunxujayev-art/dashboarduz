import type { DbClient } from '@dashboarduz/db';

import { parseTelegramDailyReportCourseIds } from '../../lib/telegram';
import { classifyCourseCategoryFromField, resolveBonusPercent, type SalaryCategory } from '../../trpc/routers/dashboard/helpers';
import { type BonusCalculationItem, type BonusPolicy, resolveCourseIncomePercent, resolveEffectiveBonusPolicy } from '../bonus-engine';
import { INCOME_LIFECYCLE_ACTIVE } from '../income-chain';
import { resolveSaleAgreementAmount } from '../income-facts';
import { buildTechnicalSaleIdSet } from '../technical-income';

const LIVE_LEADERBOARD_MANAGER_ROLES = new Set(['Admin', 'Manager']);

export type AgentGroup = 'online' | 'offline';

export type LeaderboardAgent = {
  id: string;
  name: string | null;
  username: string | null;
  roles: string[];
};

/** `Array.isArray` without widening a `readonly string[]` to `any[]`. */
function isRoleList(roles: readonly string[] | null | undefined): roles is readonly string[] {
  return Array.isArray(roles);
}

export function canReadLiveLeaderboard(
  roles: readonly string[] | null | undefined,
  group: AgentGroup,
): boolean {
  if (!isRoleList(roles)) return false;
  if (roles.some((role) => LIVE_LEADERBOARD_MANAGER_ROLES.has(role))) return true;

  return group === 'online'
    ? roles.length === 1 && roles[0] === 'Dashboard'
    : roles.length === 1 && roles[0] === 'OfflineDashboard';
}

export function resolveAgentGroup(roles: readonly string[]): AgentGroup | null {
  if (roles.includes('OnlineAgent')) return 'online';
  if (roles.includes('OfflineAgent') || roles.includes('TeamLeader')) return 'offline';

  return null;
}

export function getAgentLabel(agent: LeaderboardAgent): string {
  return agent.name?.trim() || agent.username?.trim() || 'Agent';
}

export function groupAgentRoles(group: AgentGroup): string[] {
  return group === 'online' ? ['OnlineAgent'] : ['OfflineAgent', 'TeamLeader'];
}

/** Bonus per agent from the central bonus engine, the same numbers the salary page shows. */
export function sumBonusByAgent(items: BonusCalculationItem[], agentIds: string[]): Map<string, number> {
  const wanted = new Set(agentIds);
  const totals = new Map<string, number>();

  for (const item of items) {
    if (!wanted.has(item.agentUserId)) continue;
    totals.set(item.agentUserId, (totals.get(item.agentUserId) || 0) + item.bonusAmount);
  }

  return totals;
}

/** Bonus per agent for the given courses only. Bonus items carry the course of the sale, so repayments count too. */
export function sumCourseBonusByAgent(
  items: BonusCalculationItem[],
  agentIds: string[],
  courseIds: string[],
): Map<string, number> {
  const courses = new Set(courseIds);

  return sumBonusByAgent(items.filter((item) => item.courseId !== null && courses.has(item.courseId)), agentIds);
}

/** Income of the given courses, all time: their sales plus every repayment of those sales. */
export function courseScopedIncomeWhere(courseIds: string[]) {
  return {
    OR: [
      { relatedDebtIncomeId: null, courseId: { in: courseIds } },
      { relatedDebtIncome: { courseId: { in: courseIds } } },
    ],
  };
}

type LeaderboardIncomeRow = { managerUserId: string; paymentAmount: number; entryDate: Date; type: string };

/**
 * Per-agent numbers for a board. A board belongs to a group of agents (by role), and `rows` is the board's period:
 * the selected courses on the online board, the current month on the offline board, where everything those agents
 * record counts, whatever the course category, so no sale can fall off both boards.
 */
export function summarizeLeaderboardAgents(params: {
  agentIds: string[];
  rows: LeaderboardIncomeRow[];
  todayStart: Date;
}) {
  const wanted = new Set(params.agentIds);
  const income = new Map<string, number>();
  const todayIncome = new Map<string, number>();
  const salesCount = new Map<string, number>();

  for (const row of params.rows) {
    if (!wanted.has(row.managerUserId)) continue;
    income.set(row.managerUserId, (income.get(row.managerUserId) || 0) + (row.paymentAmount || 0));
    if (row.entryDate >= params.todayStart) {
      todayIncome.set(row.managerUserId, (todayIncome.get(row.managerUserId) || 0) + (row.paymentAmount || 0));
    }
    if (row.type === 'new_sale') {
      salesCount.set(row.managerUserId, (salesCount.get(row.managerUserId) || 0) + 1);
    }
  }

  return { income, todayIncome, salesCount };
}

export function compareLeaderboardAgents(
  left: { income: number; salesCount: number; name: string; userId: string },
  right: { income: number; salesCount: number; name: string; userId: string },
): number {
  return right.income - left.income
    || right.salesCount - left.salesCount
    || left.name.localeCompare(right.name)
    || left.userId.localeCompare(right.userId);
}

/** The board's best seller: same order as the board, and an agent with nothing in the period cannot win. */
export function pickLeaderboardWinner(
  agents: LeaderboardAgent[],
  stats: ReturnType<typeof summarizeLeaderboardAgents>,
  bonusByAgent: Map<string, number>,
) {
  return agents
    .map((agent) => ({
      userId: agent.id,
      name: getAgentLabel(agent),
      salesCount: stats.salesCount.get(agent.id) || 0,
      income: stats.income.get(agent.id) || 0,
      bonus: bonusByAgent.get(agent.id) || 0,
    }))
    .filter((agent) => agent.income > 0 || agent.salesCount > 0)
    .sort(compareLeaderboardAgents)[0] || null;
}

export type AgreementSale = {
  id: string;
  managerUserId: string;
  courseId: string | null;
  coursePriceAmount: number | null;
  debtAmount: number | null;
  paymentAmount: number;
  course: { name: string; category: string } | null;
};

/**
 * Leaderboard-only bonus and debt, credited to the seller. `bonus` (Kutilma) is the policy percent applied to the
 * whole agreement of every sale, as if it were already paid in full; `bonusFact` (Fakt) is the same, but only for
 * sales the customer has already paid in full, repayments included (the payroll bonus engine still pays on payments
 * and closures). Debt is what the customer still owes on the sale. `bonusPending` is the bonus the engine would
 * still pay once the debt is repaid: the whole agreement × percent when bonus is paid on closure (debt-closed mode
 * or a course override), the remaining debt × percent when it is paid on income.
 */
export function summarizeAgreementBonusAndDebt(params: {
  agentIds: string[];
  sales: AgreementSale[];
  paidBySaleId: Map<string, number>;
  policy: BonusPolicy;
}) {
  const wanted = new Set(params.agentIds);
  const sales = params.sales.filter((sale) => wanted.has(sale.managerUserId));
  const teamAgreementByCourse = new Map<string, number>();
  const salesCountByAgentCategory = new Map<string, number>();
  const agreementByAgentCategory = new Map<string, number>();

  for (const sale of sales) {
    const agreement = resolveSaleAgreementAmount(sale);

    if (sale.courseId) {
      teamAgreementByCourse.set(sale.courseId, (teamAgreementByCourse.get(sale.courseId) || 0) + agreement);
    }
    const category = classifyCourseCategoryFromField(sale.course?.category || sale.course?.name);

    if (category !== 'other') {
      const key = `${sale.managerUserId}:${category}`;

      salesCountByAgentCategory.set(key, (salesCountByAgentCategory.get(key) || 0) + 1);
      agreementByAgentCategory.set(key, (agreementByAgentCategory.get(key) || 0) + agreement);
    }
  }

  const bonus = new Map<string, number>();
  const bonusFact = new Map<string, number>();
  const bonusPending = new Map<string, number>();
  const debt = new Map<string, number>();
  const openSales: OpenSale[] = [];

  for (const sale of sales) {
    const agreement = resolveSaleAgreementAmount(sale);
    const paid = Math.min(agreement, params.paidBySaleId.get(sale.id) || 0);
    const remaining = agreement - paid;

    debt.set(sale.managerUserId, (debt.get(sale.managerUserId) || 0) + remaining);

    const category = classifyCourseCategoryFromField(sale.course?.category || sale.course?.name);

    if (category === 'other') continue;
    const override = sale.courseId ? params.policy.courseOverrides[sale.courseId] : undefined;
    const percent = override
      ? resolveCourseIncomePercent(override, teamAgreementByCourse.get(sale.courseId!) || 0).percent
      : resolveBonusPercent(params.policy.bonusRules[category], {
          closedCount: salesCountByAgentCategory.get(`${sale.managerUserId}:${category}`) || 0,
          closedAgreementAmount: agreementByAgentCategory.get(`${sale.managerUserId}:${category}`) || 0,
        });

    bonus.set(sale.managerUserId, (bonus.get(sale.managerUserId) || 0) + Math.round(agreement * percent / 100));
    if (remaining === 0) {
      bonusFact.set(sale.managerUserId, (bonusFact.get(sale.managerUserId) || 0) + Math.round(agreement * percent / 100));
    }
    if (remaining > 0) {
      openSales.push({ managerUserId: sale.managerUserId, courseId: sale.courseId, category, agreement, remaining });
      const paidOnClosure = Boolean(override) || params.policy.bonusMode === 'on_debt_closed';
      const pending = Math.round((paidOnClosure ? agreement : remaining) * percent / 100);

      bonusPending.set(sale.managerUserId, (bonusPending.get(sale.managerUserId) || 0) + pending);
    }
  }

  return { bonus, bonusFact, bonusPending, debt, openSales };
}

export type OpenSale = {
  managerUserId: string;
  courseId: string | null;
  category: SalaryCategory;
  agreement: number;
  remaining: number;
};

/**
 * Offline Kutilma: this month's bonus in the given courses if every still-unpaid sale there were paid off this
 * month. Payroll tiers on the number of sales an agent closes in the month (or their agreement total, per the rule's
 * tier basis; every course of the category) and the
 * tier's percent applies to all of that month's closures, so the open sales raise the count and the higher percent
 * is applied to this month's closures plus the open sales. Course overrides tier on the course's team amount the
 * same way. In on-income mode an open sale adds its remaining debt instead of its whole agreement.
 */
export function projectMonthlyKutilma(params: {
  agentIds: string[];
  policy: BonusPolicy;
  monthItems: BonusCalculationItem[];
  courseIds: string[];
  openSales: OpenSale[];
}): Map<string, number> {
  const courses = new Set(params.courseIds);
  const isOverride = (courseId: string | null) => Boolean(courseId && params.policy.courseOverrides[courseId]);
  const openBase = (sale: OpenSale) => (params.policy.bonusMode === 'on_income' ? sale.remaining : sale.agreement);
  const result = new Map<string, number>();
  const add = (agentId: string, value: number) => result.set(agentId, (result.get(agentId) || 0) + value);

  const teamAmountByCourse = new Map<string, number>();

  for (const item of params.monthItems) {
    if (item.calculationMode === 'course_team_income' && item.courseId) {
      teamAmountByCourse.set(item.courseId, (teamAmountByCourse.get(item.courseId) || 0) + item.baseAmount);
    }
  }
  for (const sale of params.openSales) {
    if (isOverride(sale.courseId)) {
      teamAmountByCourse.set(sale.courseId!, (teamAmountByCourse.get(sale.courseId!) || 0) + sale.agreement);
    }
  }

  for (const agentId of params.agentIds) {
    const items = params.monthItems.filter((item) => item.agentUserId === agentId);
    const plainItems = items.filter((item) => item.calculationMode !== 'course_team_income');
    const open = params.openSales.filter((sale) => sale.managerUserId === agentId);
    const openPlain = open.filter((sale) => !isOverride(sale.courseId));
    const categories = new Set<SalaryCategory>([
      ...plainItems.filter((item) => item.courseId !== null && courses.has(item.courseId)).map((item) => item.category),
      ...openPlain.map((sale) => sale.category),
    ]);

    for (const category of categories) {
      // Tier count: what payroll counts this month (closures in every course of the category) plus the open sales.
      const categoryItems = plainItems.filter((item) => item.category === category);
      const closedCount = categoryItems.reduce((max, item) => Math.max(max, item.closedCount), 0);
      const closedAgreementAmount = categoryItems.reduce((max, item) => Math.max(max, item.closedAgreementAmount), 0);
      const openInCategory = openPlain.filter((sale) => sale.category === category);
      const percent = resolveBonusPercent(params.policy.bonusRules[category], {
        closedCount: closedCount + openInCategory.length,
        closedAgreementAmount: closedAgreementAmount + openInCategory.reduce((sum, sale) => sum + sale.agreement, 0),
      });
      const base = plainItems
        .filter((item) => item.category === category && item.courseId !== null && courses.has(item.courseId))
        .reduce((sum, item) => sum + item.baseAmount, 0)
        + openInCategory.reduce((sum, sale) => sum + openBase(sale), 0);

      add(agentId, Math.round(base * percent / 100));
    }
    for (const courseId of params.courseIds) {
      const override = params.policy.courseOverrides[courseId];

      if (!override) continue;
      const percent = resolveCourseIncomePercent(override, teamAmountByCourse.get(courseId) || 0).percent;
      const base = items
        .filter((item) => item.calculationMode === 'course_team_income' && item.courseId === courseId)
        .reduce((sum, item) => sum + item.baseAmount, 0)
        + open.filter((sale) => sale.courseId === courseId).reduce((sum, sale) => sum + sale.agreement, 0);

      add(agentId, Math.round(base * percent / 100));
    }
  }

  return result;
}

/** Loads the agents' sales matching `saleWhere`, every payment on them, and summarizes bonus and debt. */
export async function loadAgreementBonusAndDebt(params: {
  tenantId: string;
  agentIds: string[];
  saleWhere: Record<string, unknown>;
  now: Date;
  db: DbClient;
}) {
  const { db } = params;

  if (!params.agentIds.length) {
    return {
      bonus: new Map<string, number>(),
      bonusFact: new Map<string, number>(),
      bonusPending: new Map<string, number>(),
      debt: new Map<string, number>(),
      openSales: [] as OpenSale[],
    };
  }
  const [salesRaw, { policy }] = await Promise.all([
    db.income.findMany({
      where: {
        tenantId: params.tenantId,
        type: 'new_sale',
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        managerUserId: { in: params.agentIds },
        entryDate: { lte: params.now },
        ...params.saleWhere,
      },
      select: {
        id: true, type: true, managerUserId: true, courseId: true,
        coursePriceAmount: true, debtAmount: true, paymentAmount: true,
        course: { select: { name: true, category: true } },
      },
    }),
    resolveEffectiveBonusPolicy(params.tenantId, params.now, db),
  ]);
  const technicalSaleIds = buildTechnicalSaleIdSet(salesRaw);
  const sales = salesRaw.filter((sale) => !technicalSaleIds.has(sale.id));
  // Repayments count whoever recorded them: the debt belongs to the seller's customer.
  const repayments = sales.length
    ? await db.income.findMany({
        where: {
          tenantId: params.tenantId,
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          relatedDebtIncomeId: { in: sales.map((sale) => sale.id) },
          entryDate: { lte: params.now },
        },
        select: { relatedDebtIncomeId: true, paymentAmount: true },
      })
    : [];
  const paidBySaleId = new Map(sales.map((sale) => [sale.id, sale.paymentAmount || 0]));

  for (const row of repayments) {
    if (!row.relatedDebtIncomeId) continue;
    paidBySaleId.set(row.relatedDebtIncomeId, (paidBySaleId.get(row.relatedDebtIncomeId) || 0) + (row.paymentAmount || 0));
  }

  return summarizeAgreementBonusAndDebt({
    agentIds: params.agentIds,
    sales,
    paidBySaleId,
    policy,
  });
}

/**
 * The course(s) selected before the current ones: walks the selection history newest first and returns the
 * first entry's courses that are no longer selected.
 */
export function pickPreviousCourseIds(
  historyNewestFirst: string[][],
  currentCourseIds: string[],
  isEligible: (courseId: string) => boolean,
): string[] {
  const current = new Set(currentCourseIds);

  for (const selection of historyNewestFirst) {
    const previous = selection.filter((courseId) => !current.has(courseId) && isEligible(courseId));

    if (previous.length) return previous;
  }

  return [];
}

export async function loadPreviousOnlineCourses(tenantId: string, currentCourseIds: string[], db: DbClient) {
  const logs = await db.auditLog.findMany({
    where: { tenantId, action: 'integration_update', resource: 'integration' },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: { metadata: true },
  });
  const history = logs
    .filter((log) => (log.metadata as Record<string, unknown> | null)?.type === 'telegram'
      && Array.isArray((log.metadata as Record<string, unknown>).telegramDailyReportCourseIds))
    .map((log) => parseTelegramDailyReportCourseIds(log.metadata));
  const historyIds = Array.from(new Set(history.flat()));

  if (!historyIds.length) return [];
  const courses = await db.course.findMany({
    where: { tenantId, id: { in: historyIds } },
    select: { id: true, name: true, category: true },
  });
  const onlineById = new Map(courses
    .filter((course) => classifyCourseCategoryFromField(course.category || course.name) === 'online')
    .map((course) => [course.id, course]));

  return pickPreviousCourseIds(history, currentCourseIds, (courseId) => onlineById.has(courseId))
    .map((courseId) => onlineById.get(courseId)!);
}

export const incomeRowSelect = {
  id: true,
  type: true,
  relatedDebtIncomeId: true,
  managerUserId: true,
  paymentAmount: true,
  entryDate: true,
} as const;

/**
 * "Qo'shimcha xizmat" courses (not online, offline or intensive). Their sales count on the seller's
 * own board for the current month, earning the Qo'shimcha xizmat bonus rule from the bonus policy.
 */
export async function loadAdditionalServiceCourseIds(tenantId: string, db: DbClient): Promise<string[]> {
  const courses = await db.course.findMany({ where: { tenantId }, select: { id: true, name: true, category: true } });

  return courses
    .filter((course) => classifyCourseCategoryFromField(course.category || course.name) === 'additional_service')
    .map((course) => course.id);
}

/**
 * The board's income: the selected course(s) all time, plus this month's sales of the extra
 * (Qo'shimcha xizmat) courses and their repayments.
 */
export function boardIncomeWhere(selectedCourseIds: string[], extraCourseIds: string[], monthStart: Date) {
  const branches: Array<Record<string, unknown>> = [];

  if (selectedCourseIds.length) branches.push(courseScopedIncomeWhere(selectedCourseIds));
  if (extraCourseIds.length) branches.push({ AND: [courseScopedIncomeWhere(extraCourseIds), { entryDate: { gte: monthStart } }] });

  // No course at all: match nothing, as an empty course list did before.
  return branches.length ? { OR: branches } : courseScopedIncomeWhere([]);
}

type AgreementBonusAndDebt = Awaited<ReturnType<typeof loadAgreementBonusAndDebt>>;

/** Adds two bonus/debt results agent by agent. */
export function mergeAgreementBonusAndDebt(
  first: AgreementBonusAndDebt | null,
  second: AgreementBonusAndDebt | null,
): AgreementBonusAndDebt | null {
  if (!first || !second) return first ?? second;
  const sum = (a: Map<string, number>, b: Map<string, number>) => {
    const result = new Map(a);

    for (const [key, value] of b) result.set(key, (result.get(key) || 0) + value);

    return result;
  };

  return {
    bonus: sum(first.bonus, second.bonus),
    bonusFact: sum(first.bonusFact, second.bonusFact),
    bonusPending: sum(first.bonusPending, second.bonusPending),
    debt: sum(first.debt, second.debt),
    openSales: [...first.openSales, ...second.openSales],
  };
}
