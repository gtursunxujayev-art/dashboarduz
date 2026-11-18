import type { UserRole } from '@dashboarduz/shared';

import { createMoneyFixture, type MoneyFixture, seedCustomer, seedSaleChain, tashkentMonthDay, tashkentMonthKey } from '../../../__tests__/helpers/money-fixtures';
import { loadBonusIncomeDetails } from '../bonus-income-details';

let fixture: MoneyFixture;
let saleId: string;
let repaymentId: string;
const month = tashkentMonthKey(1);
const lastMonthInput = { range: 'custom' as const, dateFrom: `${month}-01`, dateTo: `${month}-28` };

function load(userId: string, roles: UserRole[], input: Partial<typeof lastMonthInput> & { managerUserId?: string; courseId?: string } = {}, options = {}) {
  return loadBonusIncomeDetails({
    ctx: { tenantId: fixture.tenantId, db: fixture.store.client(), user: { userId, roles } },
    input: { ...lastMonthInput, ...input },
    options,
  });
}

beforeEach(() => {
  fixture = createMoneyFixture();
  fixture.store.tables.get('Tenant')![0]!.settings = { salary: { bonusMode: 'on_income', bonusPercentages: { offline: 10 } } };
  const customerId = seedCustomer(fixture, '998931110000', 'Zarina');
  const chain = seedSaleChain(fixture, {
    customerId,
    agreementAmount: 3_000_000,
    firstPayment: 1_000_000,
    entryDate: tashkentMonthDay(1, 5),
    repayments: [{ amount: 2_000_000, entryDate: tashkentMonthDay(1, 15), managerUserId: fixture.otherAgentId }],
  });

  saleId = chain.saleId;
  repaymentId = chain.repaymentIds[0]!;
});

describe('loadBonusIncomeDetails', () => {
  it('lists each payment with its bonus, the chain debt after it and the closing flag', async () => {
    const result = await load(fixture.adminId, ['Admin']);

    expect(result.bonusMode).toBe('on_income');
    expect(result.scopedToCurrentAgent).toBe(false);
    expect(result.rows.map((row) => [row.id, row.managerLabel, row.paymentAmount, row.agreementAmount, row.remainingDebtAmount, row.calculatedBonus, row.isLastPayment])).toEqual([
      [repaymentId, 'Bobur', 2_000_000, 3_000_000, 0, 200_000, true],
      [saleId, 'Aziz', 1_000_000, 3_000_000, 2_000_000, 100_000, false],
    ]);
    expect(result.rows[0]!.bonusDebug).toMatchObject({ category: 'offline', appliedPercent: 10, calculationMode: 'legacy_income', finalized: false });
    expect(result.totals).toEqual({ incomeAmount: 3_000_000, bonusAmount: 300_000, rowCount: 2 });
    expect(result.agentSummary).toEqual([
      { managerUserId: fixture.agentId, managerLabel: 'Aziz', incomeAmount: 1_000_000, closedAgreementAmount: 0, totalBonusAmount: 100_000, bonusByCategory: { online: 0, offline: 100_000, intensive: 0, additional_service: 0 } },
      { managerUserId: fixture.otherAgentId, managerLabel: 'Bobur', incomeAmount: 2_000_000, closedAgreementAmount: 3_000_000, totalBonusAmount: 200_000, bonusByCategory: { online: 0, offline: 200_000, intensive: 0, additional_service: 0 } },
    ]);
    expect(result.summaryTotals).toEqual({ incomeAmount: 3_000_000, closedAgreementAmount: 3_000_000, totalBonusAmount: 300_000, bonusByCategory: { online: 0, offline: 300_000, intensive: 0, additional_service: 0 } });
    expect(result.agentOptions.map((option) => option.label)).toEqual(['Aziz', 'Bobur']);
  });

  it('scopes an agent to their own rows whatever manager they ask for', async () => {
    const result = await load(fixture.agentId, ['Agent'], { managerUserId: fixture.otherAgentId });

    expect(result.scopedToCurrentAgent).toBe(true);
    expect(result.rows.map((row) => row.id)).toEqual([saleId]);
    expect(result.totals).toEqual({ incomeAmount: 1_000_000, bonusAmount: 100_000, rowCount: 1 });
  });

  it('returns an empty report when the chosen manager is not an agent', async () => {
    const result = await load(fixture.adminId, ['Admin'], { managerUserId: fixture.financeId });

    expect(result.rows).toEqual([]);
    expect(result.totals).toEqual({ incomeAmount: 0, bonusAmount: 0, rowCount: 0 });
    expect(result.agentOptions).toEqual([]);
  });

  it('filters by course', async () => {
    const result = await load(fixture.adminId, ['Admin'], { courseId: fixture.otherCourseId });

    expect(result.rows).toEqual([]);
    expect(result.summaryTotals.totalBonusAmount).toBe(0);
  });

  it('leaves technical sales out of the rows and totals', async () => {
    const technicalCustomer = seedCustomer(fixture, '998931110009', 'Technical');

    seedSaleChain(fixture, { customerId: technicalCustomer, agreementAmount: 1, firstPayment: 1, entryDate: tashkentMonthDay(1, 6) });
    const result = await load(fixture.adminId, ['Admin']);

    expect(result.rows.map((row) => row.id)).toEqual([repaymentId, saleId]);
    expect(result.totals.incomeAmount).toBe(3_000_000);
  });

  it('refuses an export above the row limit and the Tashkiliy role', async () => {
    await expect(load(fixture.adminId, ['Admin'], {}, { rejectAboveLimit: 1 })).rejects.toThrow("Tanlangan filtr bo'yicha yozuvlar juda ko'p. Iltimos, qisqaroq davr tanlang.");
    await expect(load(fixture.adminId, ['Tashkiliy'])).rejects.toThrow('Tashkiliy role cannot access bonus income details.');
    expect((await load(fixture.adminId, ['Admin'], {}, { rowLimit: 1 })).rows).toHaveLength(1);
  });
});
