import { prisma } from '@dashboarduz/db';
import {
  buildLegacyBonusPolicy,
  calculateBonusMonth,
  reconcileBonusMonth,
  getTashkentMonthEnd,
  getTashkentMonthKey,
  getTashkentMonthStart,
  normalizeCourseOverride,
  resolveFullyPaidClosure,
  resolveCourseIncomePercent,
} from '../bonus-engine';

describe('monthly course-income bonus policy', () => {
  const rule = {
    mode: 'monthly_team_income_tiered' as const,
    fallbackPercent: 1,
    tiers: [
      { minAmount: 10_000_000, maxAmount: 19_999_999, percent: 3 },
      { minAmount: 20_000_000, maxAmount: 29_999_999, percent: 5 },
      { minAmount: 35_000_000, maxAmount: null, percent: 8 },
    ],
  };

  it('uses inclusive monetary boundaries', () => {
    expect(resolveCourseIncomePercent(rule, 10_000_000)).toEqual({ percent: 3, usedFallback: false });
    expect(resolveCourseIncomePercent(rule, 19_999_999)).toEqual({ percent: 3, usedFallback: false });
    expect(resolveCourseIncomePercent(rule, 20_000_000)).toEqual({ percent: 5, usedFallback: false });
  });

  it('uses fallback below the first tier and inside intentional gaps', () => {
    expect(resolveCourseIncomePercent(rule, 9_999_999)).toEqual({ percent: 1, usedFallback: true });
    expect(resolveCourseIncomePercent(rule, 32_000_000)).toEqual({ percent: 1, usedFallback: true });
  });

  it('keeps the final tier open-ended', () => {
    expect(resolveCourseIncomePercent(rule, 35_000_000)).toEqual({ percent: 8, usedFallback: false });
    expect(resolveCourseIncomePercent(rule, 900_000_000)).toEqual({ percent: 8, usedFallback: false });
  });

  it('normalizes valid rules and percentages', () => {
    expect(normalizeCourseOverride({ ...rule, fallbackPercent: 1.234 })).toEqual({
      ...rule,
      fallbackPercent: 1.23,
    });
  });

  it('rejects overlapping ranges', () => {
    expect(normalizeCourseOverride({
      ...rule,
      tiers: [
        { minAmount: 0, maxAmount: 10_000_000, percent: 3 },
        { minAmount: 10_000_000, maxAmount: null, percent: 5 },
      ],
    })).toBeNull();
  });

  it('rejects a capped final tier', () => {
    expect(normalizeCourseOverride({
      ...rule,
      tiers: [{ minAmount: 0, maxAmount: 10_000_000, percent: 3 }],
    })).toBeNull();
  });

  it('uses Asia/Tashkent month boundaries', () => {
    const instant = new Date('2026-08-01T00:30:00+05:00');
    expect(getTashkentMonthKey(instant)).toBe('2026-08');
    expect(getTashkentMonthStart(instant).toISOString()).toBe('2026-07-31T19:00:00.000Z');
    expect(getTashkentMonthEnd(instant).toISOString()).toBe('2026-08-31T18:59:59.999Z');
  });

  it('credits the row that closes a cross-month payment chain', () => {
    const junePayment = { id: 'sale', managerUserId: 'agent-a', paymentAmount: 4_000_000, entryDate: new Date('2026-06-10T05:00:00Z') } as any;
    const julyPayment = { id: 'repayment', managerUserId: 'agent-b', paymentAmount: 6_000_000, entryDate: new Date('2026-07-05T05:00:00Z') } as any;
    const closure = resolveFullyPaidClosure({ coursePriceAmount: 10_000_000, debtAmount: 10_000_000 }, [junePayment, julyPayment]);
    expect(closure?.closing.id).toBe('repayment');
    expect(closure?.closing.managerUserId).toBe('agent-b');
    expect(getTashkentMonthKey(closure!.closing.entryDate)).toBe('2026-07');
    expect(closure?.agreementAmount).toBe(10_000_000);
  });

  it('never closes a sale whose agreement amount is unknown', () => {
    const chain = [
      { id: 'sale', managerUserId: 'agent-a', paymentAmount: 4_000_000, entryDate: new Date('2026-06-10T05:00:00Z') },
      { id: 'repayment', managerUserId: 'agent-b', paymentAmount: 6_000_000, entryDate: new Date('2026-07-05T05:00:00Z') },
    ] as any;
    // Falling back to the running total closed this sale in June (4M) AND July (10M), paying bonus twice.
    expect(resolveFullyPaidClosure({ coursePriceAmount: null, debtAmount: null }, chain)).toBeNull();
  });
});

describe('bonus attribution and reconcile', () => {
  const july = new Date('2026-07-15T05:00:00Z');
  const onlineCourse = { id: 'course-online', name: 'Online-Iyul', category: 'online' };
  const row = (overrides: Record<string, unknown>) => ({
    type: 'repayment',
    relatedDebtIncomeId: 'sale',
    courseId: onlineCourse.id,
    coursePriceAmount: null,
    debtAmount: null,
    remainingDebtAmount: 0,
    createdAt: new Date('2026-06-10T05:00:00Z'),
    course: onlineCourse,
    ...overrides,
  });
  // Agent A sells a 10M online course and collects 4M in June; agent B collects the closing 6M in July.
  const mixedSaleRows = [
    row({ id: 'sale', type: 'new_sale', relatedDebtIncomeId: null, managerUserId: 'agent-a', coursePriceAmount: 10_000_000, debtAmount: 10_000_000, paymentAmount: 4_000_000, entryDate: new Date('2026-06-10T05:00:00Z') }),
    row({ id: 'closing', managerUserId: 'agent-b', paymentAmount: 6_000_000, entryDate: new Date('2026-07-05T05:00:00Z') }),
  ];

  beforeEach(() => {
    jest.spyOn(prisma.user, 'findMany').mockResolvedValue([
      { id: 'agent-a', roles: ['OnlineAgent'] },
      { id: 'agent-b', roles: ['OnlineAgent'] },
    ] as never);
    jest.spyOn(prisma.income, 'findMany').mockResolvedValue(mixedSaleRows as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('on_debt_closed pays the agent who records the closing payment', async () => {
    const policy = buildLegacyBonusPolicy({ salary: { bonusMode: 'on_debt_closed', bonusPercentages: { online: 5 } } });
    const result = await calculateBonusMonth({ tenantId: 't', month: july, policy });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ agentUserId: 'agent-b', sourceIncomeId: 'closing', baseAmount: 10_000_000, bonusAmount: 500_000 });
  });

  it('on_income counts the closure toward the tier of the closer, the same agent who is paid', async () => {
    const policy = buildLegacyBonusPolicy({
      salary: {
        bonusMode: 'on_income',
        bonusRules: { online: { mode: 'tiered', simplePercent: 0, tiers: [{ minSales: 1, maxSales: null, percent: 3 }] } },
      },
    });
    const result = await calculateBonusMonth({ tenantId: 't', month: july, policy });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ agentUserId: 'agent-b', closedCount: 1, appliedPercent: 3, bonusAmount: 180_000 });
  });

  it('deletes pending adjustments once the data matches the finalized snapshot again', async () => {
    const policy = buildLegacyBonusPolicy({ salary: { bonusMode: 'on_debt_closed', bonusPercentages: { online: 5 } } });
    const current = await calculateBonusMonth({ tenantId: 't', month: july, policy });
    jest.spyOn(prisma.bonusMonthSnapshot, 'findUnique').mockResolvedValue({
      id: 'snap', policy, policyVersionId: null, sourceDigest: current.sourceDigest, lines: [], adjustments: [],
    } as never);
    const deleteMany = jest.spyOn(prisma.bonusAdjustment, 'deleteMany').mockResolvedValue({ count: 1 } as never);
    await expect(reconcileBonusMonth({ tenantId: 't', month: july })).resolves.toBe(0);
    expect(deleteMany).toHaveBeenCalledWith({ where: { snapshotId: 'snap', status: 'pending' } });
  });

  it('does not claw back a finalized bonus just because the agent was deactivated', async () => {
    const policy = buildLegacyBonusPolicy({ salary: { bonusMode: 'on_debt_closed', bonusPercentages: { online: 5 } } });
    jest.spyOn(prisma.user, 'findMany').mockResolvedValue([{ id: 'agent-a', roles: ['OnlineAgent'] }] as never);
    jest.spyOn(prisma.bonusMonthSnapshot, 'findUnique').mockResolvedValue({
      id: 'snap',
      policy,
      policyVersionId: null,
      sourceDigest: 'old-digest',
      lines: [{ groupKey: 'agent-b:course-online:online:legacy_debt_closed', agentUserId: 'agent-b', courseId: 'course-online', category: 'online', bonusAmount: 500_000 }],
      adjustments: [],
    } as never);
    const create = jest.spyOn(prisma.bonusAdjustment, 'create').mockResolvedValue({ id: 'adj' } as never);
    await expect(reconcileBonusMonth({ tenantId: 't', month: july })).resolves.toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
});
