import {
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

  it('falls back to the active chain total when agreement amount is absent', () => {
    const chain = [
      { id: 'sale', managerUserId: 'agent-a', paymentAmount: 4_000_000, entryDate: new Date('2026-06-10T05:00:00Z') },
      { id: 'repayment', managerUserId: 'agent-b', paymentAmount: 6_000_000, entryDate: new Date('2026-07-05T05:00:00Z') },
    ] as any;
    const closure = resolveFullyPaidClosure({ coursePriceAmount: null, debtAmount: null }, chain);
    expect(closure?.agreementAmount).toBe(10_000_000);
    expect(closure?.closing.id).toBe('repayment');
  });
});
