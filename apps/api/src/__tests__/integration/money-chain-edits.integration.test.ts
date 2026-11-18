/**
 * Money chain edits and reads against real Postgres: chronology re-ordering, sale and repayment edits, course
 * relinking, deletes, and the reads that must skip technical (agreement = 1) sales. These pin the same flows the
 * in-memory unit tests cover, on the real database, so the unit fakes cannot drift from Postgres semantics
 * (NULL handling in NOT filters, row locks, JSON null). Skipped unless TEST_DATABASE_URL is set (see ./harness.ts).
 */
import {
  createCaller,
  createTestTenant,
  deleteTestTenant,
  describeWithDatabase,
  disconnectDatabase,
  loadPrisma,
  previousMonthDay,
  type TestTenant,
} from './harness';

jest.setTimeout(60_000);

type Caller = Awaited<ReturnType<typeof createCaller>>;

let tenant: TestTenant;
let admin: Caller;
let agent: Caller;
let courseId: string;
let tariffId: string;
let customerSeq = 0;

function customerNumber(): string {
  customerSeq += 1;

  return String(910_000_000 + Math.floor(Math.random() * 9_000_000) * 10 + customerSeq);
}

async function sale(params: { day: number; price: number; paid: number; number?: string }) {
  const number = params.number ?? customerNumber();
  const created = await admin.customerIncome.createIncome({
    entryDate: previousMonthDay(params.day).date,
    managerUserId: tenant.agentUserId,
    customerNumber: number,
    customerName: 'Chain Customer',
    type: 'new_sale',
    courseId,
    tariffId,
    coursePriceAmount: params.price,
    paymentAmount: params.paid,
    skipTelegramNotification: true,
  });

  return { saleId: created.income.id, customerId: created.income.customerId, number };
}

async function repay(number: string, saleId: string, day: number, amount: number) {
  const created = await admin.customerIncome.createIncome({
    entryDate: previousMonthDay(day).date,
    managerUserId: tenant.agentUserId,
    customerNumber: number,
    type: 'repayment',
    debtSourceIncomeId: saleId,
    paymentAmount: amount,
    skipTelegramNotification: true,
  });

  return created;
}

async function row(id: string) {
  return loadPrisma().income.findUniqueOrThrow({ where: { id } });
}

describeWithDatabase('money chain edits (Postgres integration)', () => {
  beforeAll(async () => {
    tenant = await createTestTenant('chain-edits');
    admin = await createCaller({ tenantId: tenant.tenantId, userId: tenant.adminUserId, roles: ['Admin'] });
    agent = await createCaller({ tenantId: tenant.tenantId, userId: tenant.agentUserId, roles: ['Agent'] });
    const course = await admin.customerIncome.createCourse({ name: 'Chain course', category: 'offline' });
    const tariff = await admin.customerIncome.createTariff({ courseId: course.id, name: 'Standard' });

    courseId = course.id;
    tariffId = tariff.id;
  });

  afterAll(async () => {
    if (tenant) await deleteTestTenant(tenant.tenantId);
    await disconnectDatabase();
  });

  it('a repayment dated before its sale becomes the sale of the chain', async () => {
    const { saleId, number } = await sale({ day: 12, price: 3_000_000, paid: 1_000_000 });
    const created = await repay(number, saleId, 5, 400_000);

    expect(created.debug).toEqual({ incomeChainReorderedByDate: true, canonicalSaleIncomeId: created.income.id });
    expect(await row(created.income.id)).toMatchObject({ type: 'new_sale', relatedDebtIncomeId: null, coursePriceAmount: 3_000_000, remainingDebtAmount: 1_600_000 });
    expect(await row(saleId)).toMatchObject({ type: 'repayment', relatedDebtIncomeId: created.income.id, debtAmount: 2_600_000, remainingDebtAmount: 1_600_000, legacyImportMeta: null });
  });

  it('editing the agreement and a repayment recomputes every stored debt', async () => {
    const { saleId, number } = await sale({ day: 3, price: 3_000_000, paid: 1_000_000 });
    const first = await repay(number, saleId, 6, 500_000);
    const second = await repay(number, saleId, 9, 300_000);

    await admin.customerIncome.updateIncome({ incomeId: saleId, coursePriceAmount: 4_000_000 });
    expect((await row(first.income.id))).toMatchObject({ debtAmount: 3_000_000, remainingDebtAmount: 2_500_000 });
    expect((await row(saleId)).remainingDebtAmount).toBe(2_200_000);

    await admin.customerIncome.updateIncome({ incomeId: first.income.id, paymentAmount: 800_000 });
    expect(await row(second.income.id)).toMatchObject({ debtAmount: 2_200_000, remainingDebtAmount: 1_900_000 });
    expect((await row(saleId)).remainingDebtAmount).toBe(1_900_000);

    await admin.customerIncome.deleteIncome({ incomeId: first.income.id });
    expect(await row(second.income.id)).toMatchObject({ debtAmount: 3_000_000, remainingDebtAmount: 2_700_000 });
    expect((await row(saleId)).remainingDebtAmount).toBe(2_700_000);
  });

  it('relinks one course of a customer onto another as repayments', async () => {
    const target = await sale({ day: 2, price: 5_000_000, paid: 1_000_000 });
    const source = await sale({ day: 8, price: 3_000_000, paid: 1_000_000, number: target.number });

    // The second sale of the same customer number reuses the customer.
    expect(source.customerId).toBe(target.customerId);
    const result = await admin.customerIncome.deleteCustomerCourse({ saleIncomeId: source.saleId, action: 'relink', targetSaleIncomeId: target.saleId });

    expect(result).toMatchObject({ mode: 'relink', relinkedCount: 1, targetSaleIncomeId: target.saleId });
    expect(await row(source.saleId)).toMatchObject({ type: 'repayment', relatedDebtIncomeId: target.saleId, coursePriceAmount: null, debtAmount: 4_000_000, remainingDebtAmount: 3_000_000 });
    expect((await row(target.saleId)).remainingDebtAmount).toBe(3_000_000);
  });

  it('reads skip technical sales: outstanding debts, and bonus details keep the real sales', async () => {
    const real = await sale({ day: 14, price: 2_000_000, paid: 500_000 });

    await sale({ day: 14, price: 1, paid: 0, number: real.number });

    const debts = await admin.customerIncome.customerOutstandingDebts({ customerNumber: real.number });

    expect(debts.map((debt) => [debt.id, debt.remainingDebtAmount])).toEqual([[real.saleId, 1_500_000]]);

    const { date } = previousMonthDay(1);
    const month = date.slice(0, 7);
    const details = await admin.dashboard.bonusIncomeDetails({ range: 'custom', dateFrom: `${month}-14`, dateTo: `${month}-14` });

    // NOT (id IN technical OR relatedDebtIncomeId IN technical) must keep sales whose relatedDebtIncomeId is NULL.
    expect(details.rows.map((detail) => detail.id)).toContain(real.saleId);
  });

  it('an agent cannot edit or delete incomes', async () => {
    const { saleId } = await sale({ day: 15, price: 1_000_000, paid: 100_000 });

    await expect(agent.customerIncome.updateIncome({ incomeId: saleId, paymentAmount: 200_000 })).rejects.toThrow('Admin access required');
    await expect(agent.customerIncome.deleteIncome({ incomeId: saleId })).rejects.toThrow('Admin access required');
    expect((await row(saleId)).paymentAmount).toBe(100_000);
  });
});
