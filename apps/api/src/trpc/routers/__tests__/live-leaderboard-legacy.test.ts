import { prisma } from '../dashboard/helpers';
import { calculateMonthlyBonusByAgent } from '../dashboard/live-leaderboard';

const monthStart = new Date('2026-06-30T19:00:00.000Z');
const monthEnd = new Date('2026-07-31T18:59:59.999Z');

function tenantSettings(bonusMode: 'on_income' | 'on_debt_closed', onlineRule: Record<string, unknown>) {
  return {
    salary: {
      bonusMode,
      bonusRules: {
        online: onlineRule,
        offline: { mode: 'simple', simplePercent: 25, tiers: [] },
        intensive: { mode: 'simple', simplePercent: 0, tiers: [] },
        additional_service: { mode: 'simple', simplePercent: 0, tiers: [] },
      },
      courseBonusOverrides: {
        'course-online': {
          mode: 'monthly_team_income_tiered',
          fallbackPercent: 99,
          tiers: [{ minAmount: 0, maxAmount: null, percent: 99 }],
        },
      },
    },
  };
}

describe('legacy live leaderboard bonus calculation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses payment income, the category sales-count tier, and the requested group', async () => {
    jest.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
      settings: tenantSettings('on_income', {
        mode: 'tiered',
        simplePercent: 2,
        tiers: [{ minSales: 1, maxSales: null, percent: 10 }],
      }),
    } as never);
    jest.spyOn(prisma.income, 'findMany')
      .mockResolvedValueOnce([{
        id: 'sale-online',
        managerUserId: 'agent-1',
        entryDate: new Date('2026-07-10T10:00:00.000Z'),
        coursePriceAmount: 2_000_000,
        debtAmount: 0,
        paymentAmount: 2_000_000,
        course: { name: 'Online', category: 'online' },
      }] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          id: 'income-online',
          type: 'new_sale',
          relatedDebtIncomeId: null,
          managerUserId: 'agent-1',
          paymentAmount: 1_000_000,
          course: { name: 'Online', category: 'online' },
          relatedDebtIncome: null,
        },
        {
          id: 'income-offline',
          type: 'new_sale',
          relatedDebtIncomeId: null,
          managerUserId: 'agent-1',
          paymentAmount: 3_000_000,
          course: { name: 'Offline', category: 'offline' },
          relatedDebtIncome: null,
        },
      ] as never);

    const result = await calculateMonthlyBonusByAgent({
      tenantId: 'tenant-1',
      agentIds: ['agent-1'],
      monthStart,
      monthEnd,
      technicalSaleIds: new Set(),
      group: 'online',
    });

    expect(result.get('agent-1')).toBe(100_000);
  });

  it('uses the agreement amount when debt closes and ignores course overrides', async () => {
    jest.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
      settings: tenantSettings('on_debt_closed', {
        mode: 'simple',
        simplePercent: 5,
        tiers: [],
      }),
    } as never);
    jest.spyOn(prisma.income, 'findMany')
      .mockResolvedValueOnce([
        {
          id: 'sale-online',
          managerUserId: 'agent-1',
          entryDate: new Date('2026-07-12T10:00:00.000Z'),
          coursePriceAmount: 2_000_000,
          debtAmount: 0,
          paymentAmount: 500_000,
          course: { name: 'Online', category: 'online' },
        },
        {
          id: 'sale-offline',
          managerUserId: 'agent-1',
          entryDate: new Date('2026-07-12T10:00:00.000Z'),
          coursePriceAmount: 4_000_000,
          debtAmount: 0,
          paymentAmount: 4_000_000,
          course: { name: 'Offline', category: 'offline' },
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const result = await calculateMonthlyBonusByAgent({
      tenantId: 'tenant-1',
      agentIds: ['agent-1'],
      monthStart,
      monthEnd,
      technicalSaleIds: new Set(),
      group: 'online',
    });

    expect(result.get('agent-1')).toBe(100_000);
  });
});
