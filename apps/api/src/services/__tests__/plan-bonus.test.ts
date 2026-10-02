import type { SaleClosure } from '../bonus-engine';
import { computePlanProgressByAgent } from '../plan-bonus';

function closure(closedAt: string, overrides: Partial<SaleClosure> = {}): SaleClosure {
  return {
    saleId: `sale-${closedAt}`,
    closingIncomeId: `closing-${closedAt}`,
    closerUserId: 'agent-a',
    sellerUserId: 'agent-a',
    closedAt: new Date(closedAt),
    agreementAmount: 1_000_000,
    category: 'online',
    courseId: 'course-1',
    tariffId: 'tariff-1',
    profileSubTariffId: null,
    ...overrides,
  };
}

const basePlan = {
  id: 'plan',
  name: 'Reja',
  isActive: true,
  courseCategory: 'online' as const,
  courseId: null,
  tariffId: null,
  subTariffId: null,
  subTariffName: null,
  targetClosedSales: 10,
  bonusAmount: 1_000_000,
  createdAt: '',
  updatedAt: '',
};

const september = {
  rangeStart: new Date('2026-08-31T19:00:00.000Z'),
  rangeEnd: new Date('2026-09-30T18:59:59.999Z'),
};

function run(plan: typeof basePlan & { periodMode: 'monthly' | 'all_time' }, closures: SaleClosure[], range = september) {
  return computePlanProgressByAgent({
    plans: [plan],
    closures,
    agentIds: ['agent-a'],
    subTariffNameById: new Map(),
    ...range,
  }).get('agent-a')![0]!;
}

describe('plan bonus', () => {
  it('pays an all_time reward only in the month it is reached, not again every month', () => {
    // 22 closures before September and 3 in September: lifetime 25, units 2 before and 2 after.
    const before = Array.from({ length: 22 }, (_, index) => closure(`2026-0${(index % 5) + 3}-1${index % 9}T05:00:00Z`));
    const inSeptember = Array.from({ length: 3 }, (_, index) => closure(`2026-09-1${index}T05:00:00Z`));
    const progress = run({ ...basePlan, periodMode: 'all_time' }, [...before, ...inSeptember]);
    expect(progress.fact).toBe(25);
    expect(progress.completedUnits).toBe(0);
    expect(progress.earnedAmount).toBe(0);
  });

  it('pays an all_time unit in the month the lifetime count crosses the target', () => {
    const before = Array.from({ length: 8 }, (_, index) => closure(`2026-08-1${index}T05:00:00Z`));
    const inSeptember = Array.from({ length: 3 }, (_, index) => closure(`2026-09-1${index}T05:00:00Z`));
    const progress = run({ ...basePlan, periodMode: 'all_time' }, [...before, ...inSeptember]);
    expect(progress.completedUnits).toBe(1);
    expect(progress.earnedAmount).toBe(1_000_000);
  });

  it('counts monthly plans per calendar month, never adding months together', () => {
    const august = Array.from({ length: 6 }, (_, index) => closure(`2026-08-1${index}T05:00:00Z`));
    const sept = Array.from({ length: 6 }, (_, index) => closure(`2026-09-1${index}T05:00:00Z`));
    const twoMonths = { rangeStart: new Date('2026-07-31T19:00:00.000Z'), rangeEnd: september.rangeEnd };
    const progress = run({ ...basePlan, periodMode: 'monthly' }, [...august, ...sept], twoMonths);
    expect(progress.fact).toBe(12);
    expect(progress.completedUnits).toBe(0);
  });

  it('credits closures to the closer and respects the plan category', () => {
    const progress = run({ ...basePlan, periodMode: 'monthly', targetClosedSales: 1 }, [
      closure('2026-09-10T05:00:00Z', { closerUserId: 'agent-b', sellerUserId: 'agent-a' }),
      closure('2026-09-11T05:00:00Z', { category: 'offline' }),
      closure('2026-09-12T05:00:00Z'),
    ]);
    expect(progress.fact).toBe(1);
    expect(progress.earnedAmount).toBe(1_000_000);
  });
});
