import { prisma } from '@dashboarduz/db';
import { buildLegacyBonusPolicy, calculateBonusMonth, type BonusCalculationItem } from '../../../services/bonus-engine';
import {
  compareLeaderboardAgents,
  courseScopedIncomeWhere,
  pickLeaderboardWinner,
  pickPreviousCourseIds,
  projectMonthlyKutilma,
  sumBonusByAgent,
  summarizeAgreementBonusAndDebt,
  sumCourseBonusByAgent,
  summarizeLeaderboardAgents,
} from '../dashboard/live-leaderboard';

describe('live leaderboard numbers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the same bonus as the salary page because both read the bonus engine', async () => {
    const onlineCourse = { id: 'course-online', name: 'Online-Iyul', category: 'online' };
    jest.spyOn(prisma.user, 'findMany').mockResolvedValue([
      { id: 'agent-a', roles: ['OnlineAgent'] },
      { id: 'agent-b', roles: ['OnlineAgent'] },
    ] as never);
    jest.spyOn(prisma.income, 'findMany').mockResolvedValue([
      {
        id: 'sale', type: 'new_sale', relatedDebtIncomeId: null, managerUserId: 'agent-a', courseId: onlineCourse.id,
        coursePriceAmount: 10_000_000, debtAmount: 10_000_000, paymentAmount: 4_000_000, remainingDebtAmount: 0,
        entryDate: new Date('2026-06-10T05:00:00Z'), createdAt: new Date('2026-06-10T05:00:00Z'), course: onlineCourse,
      },
      {
        id: 'closing', type: 'repayment', relatedDebtIncomeId: 'sale', managerUserId: 'agent-b', courseId: onlineCourse.id,
        coursePriceAmount: null, debtAmount: null, paymentAmount: 6_000_000, remainingDebtAmount: 0,
        entryDate: new Date('2026-07-05T05:00:00Z'), createdAt: new Date('2026-07-05T05:00:00Z'), course: onlineCourse,
      },
    ] as never);
    const policy = buildLegacyBonusPolicy({ salary: { bonusMode: 'on_debt_closed', bonusPercentages: { online: 5 } } });
    const month = await calculateBonusMonth({ tenantId: 't', month: new Date('2026-07-15T05:00:00Z'), policy });

    // The salary page adds item.bonusAmount per item.agentUserId; the leaderboard must give identical totals.
    const salaryPageTotals = new Map<string, number>();
    for (const item of month.items) {
      salaryPageTotals.set(item.agentUserId, (salaryPageTotals.get(item.agentUserId) || 0) + item.bonusAmount);
    }
    expect(sumBonusByAgent(month.items, ['agent-a', 'agent-b'])).toEqual(salaryPageTotals);
    expect(salaryPageTotals.get('agent-b')).toBe(500_000);
  });

  it('counts an agent’s sale on their own board even when the course belongs to the other group', () => {
    const todayStart = new Date('2026-09-30T00:00:00+05:00');
    const stats = summarizeLeaderboardAgents({
      agentIds: ['online-agent'],
      todayStart,
      rows: [
        // An online agent selling an offline course used to vanish from both boards.
        { managerUserId: 'online-agent', type: 'new_sale', paymentAmount: 4_000_000, entryDate: new Date('2026-09-30T10:00:00+05:00') },
        { managerUserId: 'online-agent', type: 'repayment', paymentAmount: 1_000_000, entryDate: new Date('2026-09-10T10:00:00+05:00') },
        { managerUserId: 'someone-else', type: 'new_sale', paymentAmount: 9_000_000, entryDate: new Date('2026-09-30T10:00:00+05:00') },
      ],
    });
    expect(stats.income.get('online-agent')).toBe(5_000_000);
    expect(stats.todayIncome.get('online-agent')).toBe(4_000_000);
    expect(stats.salesCount.get('online-agent')).toBe(1);
    expect(stats.income.has('someone-else')).toBe(false);
  });

  it('adds up bonus across months but only for the selected courses', () => {
    const bonusItem = (agentUserId: string, courseId: string | null, bonusAmount: number, eventDate: string) => ({
      agentUserId, courseId, bonusAmount, eventDate: new Date(eventDate),
    }) as BonusCalculationItem;
    const items = [
      bonusItem('agent-a', 'course-selected', 100_000, '2026-08-20T05:00:00Z'),
      bonusItem('agent-a', 'course-selected', 250_000, '2026-10-02T05:00:00Z'),
      bonusItem('agent-a', 'course-other', 900_000, '2026-10-03T05:00:00Z'),
      bonusItem('agent-a', null, 900_000, '2026-10-03T05:00:00Z'),
      bonusItem('agent-b', 'course-selected', 50_000, '2026-10-04T05:00:00Z'),
    ];
    const bonus = sumCourseBonusByAgent(items, ['agent-a'], ['course-selected']);
    expect(bonus.get('agent-a')).toBe(350_000);
    expect(bonus.has('agent-b')).toBe(false);
  });

  it('matches a repayment by the course of its sale, and a sale by its own course', () => {
    expect(courseScopedIncomeWhere(['course-selected'])).toEqual({
      OR: [
        { relatedDebtIncomeId: null, courseId: { in: ['course-selected'] } },
        { relatedDebtIncome: { courseId: { in: ['course-selected'] } } },
      ],
    });
  });

  it('counts every row of the course, whatever month it was paid in', () => {
    const stats = summarizeLeaderboardAgents({
      agentIds: ['agent-a'],
      todayStart: new Date('2026-10-31T00:00:00+05:00'),
      rows: [
        { managerUserId: 'agent-a', type: 'new_sale', paymentAmount: 2_000_000, entryDate: new Date('2026-08-15T10:00:00+05:00') },
        { managerUserId: 'agent-a', type: 'repayment', paymentAmount: 3_000_000, entryDate: new Date('2026-10-31T10:00:00+05:00') },
      ],
    });
    expect(stats.income.get('agent-a')).toBe(5_000_000);
    expect(stats.todayIncome.get('agent-a')).toBe(3_000_000);
    expect(stats.salesCount.get('agent-a')).toBe(1);
  });

  it('picks the best seller in board order and ignores agents with nothing in the period', () => {
    const agents = [
      { id: 'a', name: 'Ali', username: null, roles: ['OnlineAgent'] },
      { id: 'b', name: 'Bobur', username: null, roles: ['OnlineAgent'] },
      { id: 'c', name: 'Zilola', username: null, roles: ['OnlineAgent'] },
    ];
    const stats = summarizeLeaderboardAgents({
      agentIds: ['a', 'b', 'c'],
      todayStart: new Date('2026-10-31T00:00:00+05:00'),
      rows: [
        { managerUserId: 'a', type: 'new_sale', paymentAmount: 1_000_000, entryDate: new Date('2026-09-01T10:00:00+05:00') },
        { managerUserId: 'b', type: 'new_sale', paymentAmount: 7_000_000, entryDate: new Date('2026-08-01T10:00:00+05:00') },
      ],
    });
    expect(pickLeaderboardWinner(agents, stats, new Map([['b', 300_000]]))).toEqual({
      userId: 'b', name: 'Bobur', salesCount: 1, income: 7_000_000, bonus: 300_000,
    });
    expect(pickLeaderboardWinner(agents.slice(2), stats, new Map())).toBeNull();
  });

  it('ranks by income, then sales, then name, then a stable id', () => {
    const agents = [
      { userId: 'b', name: 'Agent', income: 100, salesCount: 1 },
      { userId: 'a', name: 'Agent', income: 100, salesCount: 1 },
      { userId: 'c', name: 'Zilola', income: 200, salesCount: 0 },
    ];
    expect([...agents].sort(compareLeaderboardAgents).map((agent) => agent.userId)).toEqual(['c', 'a', 'b']);
  });

  it('pays leaderboard bonus on the whole agreement and counts the unpaid rest as debt', () => {
    const course = { name: 'Online-Noyabr', category: 'online' };
    const policy = buildLegacyBonusPolicy({ salary: { bonusMode: 'on_debt_closed', bonusPercentages: { online: 5 } } });
    const result = summarizeAgreementBonusAndDebt({
      agentIds: ['a', 'b'],
      policy,
      sales: [
        { id: 's1', managerUserId: 'a', courseId: 'c1', coursePriceAmount: 10_000_000, debtAmount: null, paymentAmount: 4_000_000, course },
        { id: 's2', managerUserId: 'a', courseId: 'c1', coursePriceAmount: 6_000_000, debtAmount: null, paymentAmount: 6_000_000, course },
        { id: 's3', managerUserId: 'x', courseId: 'c1', coursePriceAmount: 9_000_000, debtAmount: null, paymentAmount: 0, course },
      ],
      paidBySaleId: new Map([['s1', 7_000_000], ['s2', 6_000_000], ['s3', 0]]),
    });
    expect(result.bonus.get('a')).toBe(800_000);
    // Fakt: only s2 is paid in full (6M); s1 still owes 3M.
    expect(result.bonusFact.get('a')).toBe(300_000);
    // Debt-closed mode pays on the whole agreement once s1 (3M still owed) closes.
    expect(result.bonusPending.get('a')).toBe(500_000);
    expect(result.debt.get('a')).toBe(3_000_000);
    expect(result.bonus.has('x')).toBe(false);
  });

  it('finds the course selected before the current one', () => {
    const online = new Set(['oct', 'sep', 'nov']);
    const history = [['nov'], ['nov', 'offline-1'], ['oct', 'offline-1'], ['sep']];
    expect(pickPreviousCourseIds(history, ['nov'], (id) => online.has(id))).toEqual(['oct']);
    expect(pickPreviousCourseIds([['nov']], ['nov'], (id) => online.has(id))).toEqual([]);
  });

  it('projects Kutilma at the tier the agent reaches once every open debt closes this month', () => {
    const policy = buildLegacyBonusPolicy({ salary: { bonusMode: 'on_debt_closed' } });
    policy.bonusRules.offline = {
      mode: 'tiered',
      simplePercent: 5,
      tiers: [
        { minSales: 1, maxSales: 3, percent: 2 },
        { minSales: 4, maxSales: 5, percent: 3 },
        { minSales: 6, maxSales: 7, percent: 4 },
        { minSales: 8, maxSales: 9, percent: 5 },
        { minSales: 10, maxSales: 15, percent: 6 },
      ],
    };
    const closed = (id: string): BonusCalculationItem => ({
      sourceKey: id, sourceIncomeId: id, sourceSaleId: id, agentUserId: 'm', courseId: 'c', courseName: null,
      category: 'offline', calculationMode: 'legacy_debt_closed', eventDate: new Date('2026-11-05T05:00:00Z'),
      baseAmount: 10_000_000, appliedPercent: 2, bonusAmount: 200_000, agreementAmount: 10_000_000,
      closingIncomeId: id, closedCount: 2, usedFallback: false,
    });
    const openSales = Array.from({ length: 6 }, () => ({
      managerUserId: 'm', courseId: 'c', category: 'offline' as const, agreement: 10_000_000, remaining: 8_000_000,
    }));
    const kutilma = projectMonthlyKutilma({
      agentIds: ['m'], policy, monthItems: [closed('a'), closed('b')], courseIds: ['c'], openSales,
    });
    // 2 closed + 6 open = 8 closures, so 5% on all 8 agreements (80M), not the 2% paid today.
    expect(kutilma.get('m')).toBe(4_000_000);
  });
});
