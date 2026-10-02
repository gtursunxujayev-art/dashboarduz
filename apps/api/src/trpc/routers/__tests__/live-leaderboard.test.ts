import { prisma } from '@dashboarduz/db';
import { buildLegacyBonusPolicy, calculateBonusMonth } from '../../../services/bonus-engine';
import {
  compareLeaderboardAgents,
  sumBonusByAgent,
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
      monthRows: [
        // An online agent selling an offline course used to vanish from both boards.
        { managerUserId: 'online-agent', type: 'new_sale', paymentAmount: 4_000_000, entryDate: new Date('2026-09-30T10:00:00+05:00') },
        { managerUserId: 'online-agent', type: 'repayment', paymentAmount: 1_000_000, entryDate: new Date('2026-09-10T10:00:00+05:00') },
        { managerUserId: 'someone-else', type: 'new_sale', paymentAmount: 9_000_000, entryDate: new Date('2026-09-30T10:00:00+05:00') },
      ],
    });
    expect(stats.monthIncome.get('online-agent')).toBe(5_000_000);
    expect(stats.todayIncome.get('online-agent')).toBe(4_000_000);
    expect(stats.monthlySales.get('online-agent')).toBe(1);
    expect(stats.monthIncome.has('someone-else')).toBe(false);
  });

  it('ranks by income, then sales, then name, then a stable id', () => {
    const agents = [
      { userId: 'b', name: 'Agent', income: 100, salesCount: 1 },
      { userId: 'a', name: 'Agent', income: 100, salesCount: 1 },
      { userId: 'c', name: 'Zilola', income: 200, salesCount: 0 },
    ];
    expect([...agents].sort(compareLeaderboardAgents).map((agent) => agent.userId)).toEqual(['c', 'a', 'b']);
  });
});
