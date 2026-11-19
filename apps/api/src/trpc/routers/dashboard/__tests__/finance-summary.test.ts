import type { JWTPayload } from '@dashboarduz/shared';

import type { InMemoryPrisma } from '../../../../__tests__/helpers/in-memory-prisma';
import { contextFor, createMoneyFixture, dayString, daysAgo, type MoneyFixture, seedCustomer, seedSaleChain } from '../../../../__tests__/helpers/money-fixtures';
import { router } from '../../../trpc';
import { financeSummaryProcedures } from '../finance-summary';

let mockStore: InMemoryPrisma;

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual('@dashboarduz/db'),
  forTenant: () => mockStore.client(),
}));

const financeRouter = router(financeSummaryProcedures);
let fixture: MoneyFixture;
const previousRedis = process.env.REDIS_URL;

const caller = (userId: string, roles: JWTPayload['roles']) => financeRouter.createCaller(contextFor(fixture, userId, roles));
const range = () => ({ range: 'custom' as const, dateFrom: dayString(daysAgo(60)), dateTo: dayString(daysAgo(0)) });

// Payments that count as income: active and not part of a technical (agreement = 1) sale.
const countedPayments: Array<{ amount: number; entryDate: Date }> = [];

beforeAll(() => {
  delete process.env.REDIS_URL;
});

afterAll(() => {
  if (previousRedis !== undefined) process.env.REDIS_URL = previousRedis;
});

beforeEach(() => {
  fixture = createMoneyFixture();
  mockStore = fixture.store;
  countedPayments.length = 0;
  const ali = seedCustomer(fixture, '998900000001', 'Ali');
  const vali = seedCustomer(fixture, '998900000002', 'Vali');
  const gani = seedCustomer(fixture, '998900000003', 'Gani');
  const tech = seedCustomer(fixture, '998900000004', 'Technical');

  // Aziz: a 3 000 000 sale, 1 000 000 paid, then 500 000 more; 1 500 000 still owed.
  seedSaleChain(fixture, { customerId: ali, agreementAmount: 3_000_000, firstPayment: 1_000_000, entryDate: daysAgo(10), repayments: [{ amount: 500_000, entryDate: daysAgo(5) }] });
  // Bobur: a fully paid 2 000 000 sale of the other course.
  seedSaleChain(fixture, { customerId: vali, managerUserId: fixture.otherAgentId, agreementAmount: 2_000_000, firstPayment: 2_000_000, entryDate: daysAgo(3), courseId: fixture.otherCourseId, tariffId: fixture.otherTariffId });
  // A refunded sale and a technical one: neither is income.
  seedSaleChain(fixture, { customerId: gani, agreementAmount: 1_000_000, firstPayment: 800_000, entryDate: daysAgo(4), lifecycleStatus: 'refunded' });
  seedSaleChain(fixture, { customerId: tech, agreementAmount: 1, firstPayment: 1, entryDate: daysAgo(2) });
  countedPayments.push(
    { amount: 1_000_000, entryDate: daysAgo(10) },
    { amount: 500_000, entryDate: daysAgo(5) },
    { amount: 2_000_000, entryDate: daysAgo(3) },
  );
});

describe('financeSummary', () => {
  it('totals active income, open debt and refunds, skipping technical sales', async () => {
    const summary = await caller(fixture.adminId, ['Admin']).financeSummary(range());

    expect(summary.totals).toEqual({
      totalIncomeAmount: 3_500_000,
      newSalesCount: 2,
      repaymentCount: 1,
      refundCount: 1,
      refundAmount: 800_000,
      debtorsCount: 1,
      totalDebtAmount: 1_500_000,
    });
    expect(summary.incomeByCourse).toEqual([
      { courseName: 'IELTS Intensive', count: 1, amount: 2_000_000, agreementAmount: 2_000_000 },
      { courseName: 'Foundation English', count: 2, amount: 1_500_000, agreementAmount: 3_000_000 },
    ]);
    expect(summary.incomeByAgent).toEqual([
      { agent: 'Bobur', count: 1, amount: 2_000_000 },
      { agent: 'Aziz', count: 2, amount: 1_500_000 },
    ]);
    expect(summary.filters).toEqual({ courseId: null, managerUserId: null, agentScoped: false });
    expect(summary.recentIncomes).toHaveLength(4);
    expect(summary.recentIncomes.map((row) => row.paymentAmount)).toEqual([2_000_000, 800_000, 500_000, 1_000_000]);
    expect(summary.courseOptions).toEqual([
      { id: fixture.courseId, name: 'Foundation English', category: 'offline' },
      { id: fixture.otherCourseId, name: 'IELTS Intensive', category: 'intensive' },
    ]);
    expect(summary.managerOptions.map((option) => option.label)).toEqual(['Admin', 'Aziz', 'Bobur', 'Malika']);
  });

  it('builds the month-to-date figure and forecast from active payments of this Tashkent month', async () => {
    const summary = await caller(fixture.adminId, ['Admin']).financeSummary(range());
    const monthStart = new Date(summary.comparisons.monthToDateVsLastMonthToDate.currentStart);
    const yearStart = new Date(summary.comparisons.ytdVsLastYearYtd.currentStart);
    const monthToDate = countedPayments.filter((payment) => payment.entryDate >= monthStart).reduce((sum, payment) => sum + payment.amount, 0);
    const yearToDate = countedPayments.filter((payment) => payment.entryDate >= yearStart).reduce((sum, payment) => sum + payment.amount, 0);

    expect(summary.forecast.monthEnd.currentToDate).toBe(monthToDate);
    expect(summary.forecast.yearEnd.currentToDate).toBe(yearToDate);
    expect(summary.forecast.yearSeries).toHaveLength(12);
    expect(summary.forecast.monthSeries.filter((point) => point.actual !== null).at(-1)?.actual).toBe(monthToDate);
    expect(summary.forecast.monthEnd.remainingAmount).toBe(Math.max(0, summary.forecast.monthEnd.projectedTotal - monthToDate));
  });

  it('scopes an agent to their own income and manager option', async () => {
    const summary = await caller(fixture.agentId, ['Agent']).financeSummary({ ...range(), managerUserId: fixture.otherAgentId });

    expect(summary.filters).toEqual({ courseId: null, managerUserId: fixture.agentId, agentScoped: true });
    expect(summary.totals).toMatchObject({ totalIncomeAmount: 1_500_000, newSalesCount: 1, repaymentCount: 1, totalDebtAmount: 1_500_000, refundAmount: 800_000 });
    expect(summary.managerOptions.map((option) => option.id)).toEqual([fixture.agentId]);
  });

  it('scopes a team leader to their group and rejects a manager outside it', async () => {
    const [leader] = fixture.store.seed('User', [{ tenantId: fixture.tenantId, name: 'Lola', username: 'lola', roles: ['OfflineTeamLeader'], authProvider: 'email' }]);
    const leaderId = String(leader!.id);

    await fixture.store.client().user.update({ where: { id: fixture.otherAgentId }, data: { roles: ['OfflineAgent'] } });

    const summary = await caller(leaderId, ['OfflineTeamLeader']).financeSummary(range());

    expect(summary.filters.agentScoped).toBe(false);
    expect(summary.totals.totalIncomeAmount).toBe(2_000_000);
    expect(summary.managerOptions.map((option) => option.id).sort()).toEqual([fixture.otherAgentId, leaderId].sort());
    await expect(caller(leaderId, ['OfflineTeamLeader']).financeSummary({ ...range(), managerUserId: fixture.agentId })).rejects.toThrow('outside your access scope');
  });

  it('filters by course and by manager for an admin', async () => {
    const byCourse = await caller(fixture.adminId, ['Admin']).financeSummary({ ...range(), courseId: fixture.otherCourseId });
    const byManager = await caller(fixture.financeId, ['Finance']).financeSummary({ ...range(), managerUserId: fixture.otherAgentId });

    expect(byCourse.totals).toMatchObject({ totalIncomeAmount: 2_000_000, newSalesCount: 1, debtorsCount: 0, refundCount: 0 });
    expect(byManager.totals.totalIncomeAmount).toBe(2_000_000);
    expect(byManager.filters.managerUserId).toBe(fixture.otherAgentId);
  });

  it('refuses the Tashkiliy role', async () => {
    await expect(caller(fixture.adminId, ['Tashkiliy']).financeSummary(range())).rejects.toThrow('Tashkiliy role cannot access finance summary.');
  });
});
