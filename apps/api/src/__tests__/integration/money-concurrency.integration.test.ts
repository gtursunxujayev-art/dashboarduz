/**
 * Concurrency tests for the money paths: two requests that race on the same sale, request or month.
 * Real Postgres, real tRPC procedures, one throwaway tenant per test. Skipped unless TEST_DATABASE_URL is set
 * (see ./harness.ts).
 *
 * Each test fires both requests at once and asserts that exactly one of them took effect and that the stored
 * money is what one request alone would have produced (no debt applied twice, no request reviewed twice).
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

const COURSE_PRICE = 3_000_000;
const FIRST_PAYMENT = 1_000_000;
const OPEN_DEBT = COURSE_PRICE - FIRST_PAYMENT;

type SaleFixture = {
  tenant: TestTenant;
  admin: Caller;
  agent: Caller;
  saleId: string;
  customerNumber: string;
  saleDate: string;
  saleMonth: string;
};

async function setUpSale(label: string): Promise<SaleFixture> {
  const tenant = await createTestTenant(label);
  const admin = await createCaller({ tenantId: tenant.tenantId, userId: tenant.adminUserId, roles: ['Admin'] });
  const agent = await createCaller({ tenantId: tenant.tenantId, userId: tenant.agentUserId, roles: ['Agent'] });
  const course = await admin.customerIncome.createCourse({ name: `Course ${label}`, category: 'online' });
  const tariff = await admin.customerIncome.createTariff({ courseId: course.id, name: 'Standard' });
  const { date: saleDate, month: saleMonth } = previousMonthDay(10);
  const customerNumber = String(900_000_000 + Math.floor(Math.random() * 99_999_999));
  const created = await agent.customerIncome.createIncome({
    entryDate: saleDate,
    managerUserId: tenant.agentUserId,
    customerNumber,
    customerName: 'Concurrency Customer',
    type: 'new_sale',
    courseId: course.id,
    tariffId: tariff.id,
    coursePriceAmount: COURSE_PRICE,
    paymentAmount: FIRST_PAYMENT,
  });

  return { tenant, admin, agent, saleId: created.income.id, customerNumber, saleDate, saleMonth };
}

function outcome(results: PromiseSettledResult<unknown>[]): { fulfilled: number; rejected: string[] } {
  return {
    fulfilled: results.filter((result) => result.status === 'fulfilled').length,
    rejected: results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => String((result.reason as Error | undefined)?.message ?? result.reason)),
  };
}

describeWithDatabase('money paths under concurrency (Postgres integration)', () => {
  const tenantsToClean: string[] = [];

  afterEach(async () => {
    while (tenantsToClean.length) {
      await deleteTestTenant(tenantsToClean.pop()!);
    }
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  async function sale(label: string): Promise<SaleFixture> {
    const fixture = await setUpSale(label);

    tenantsToClean.push(fixture.tenant.tenantId);

    return fixture;
  }

  it('applies only one of two simultaneous repayments that each pay off the whole debt', async () => {
    const { tenant, agent, saleId, customerNumber, saleDate } = await sale('race-repayment');
    const prisma = loadPrisma();
    const repay = () => agent.customerIncome.createIncome({
      entryDate: saleDate,
      managerUserId: tenant.agentUserId,
      customerNumber,
      type: 'repayment',
      debtSourceIncomeId: saleId,
      paymentAmount: OPEN_DEBT,
    });

    const result = outcome(await Promise.allSettled([repay(), repay()]));

    expect(result.fulfilled).toBe(1);
    expect(result.rejected).toEqual([expect.stringMatching(/no remaining debt|cannot exceed/)]);

    const repayments = await prisma.income.findMany({ where: { relatedDebtIncomeId: saleId, type: 'repayment' } });
    const storedSale = await prisma.income.findUniqueOrThrow({ where: { id: saleId } });

    expect(repayments).toHaveLength(1);
    expect(repayments.reduce((sum, row) => sum + row.paymentAmount, 0)).toBe(OPEN_DEBT);
    expect(storedSale.remainingDebtAmount).toBe(0);
  });

  it('records two smaller simultaneous repayments one after the other, never from the same old debt', async () => {
    const { tenant, agent, saleId, customerNumber, saleDate } = await sale('race-repayment-partial');
    const prisma = loadPrisma();
    const repay = () => agent.customerIncome.createIncome({
      entryDate: saleDate,
      managerUserId: tenant.agentUserId,
      customerNumber,
      type: 'repayment',
      debtSourceIncomeId: saleId,
      paymentAmount: 500_000,
    });

    const result = outcome(await Promise.allSettled([repay(), repay()]));

    expect(result).toEqual({ fulfilled: 2, rejected: [] });

    const repayments = await prisma.income.findMany({
      where: { relatedDebtIncomeId: saleId, type: 'repayment' },
      orderBy: { remainingDebtAmount: 'desc' },
    });
    const storedSale = await prisma.income.findUniqueOrThrow({ where: { id: saleId } });

    // The second repayment starts from the debt the first one left, so the remaining debts differ.
    expect(repayments.map((row) => row.remainingDebtAmount)).toEqual([OPEN_DEBT - 500_000, OPEN_DEBT - 1_000_000]);
    expect(storedSale.remainingDebtAmount).toBe(OPEN_DEBT - 1_000_000);
  });

  it('creates only one of two simultaneous refund requests for the same sale', async () => {
    const { agent, saleId } = await sale('race-refund-request');
    const prisma = loadPrisma();
    const request = () => agent.customerIncome.createAdjustmentRequest({
      type: 'refund',
      incomeId: saleId,
      reason: 'Race',
      refundCardNumber: '8600123412341234',
    });

    const result = outcome(await Promise.allSettled([request(), request()]));

    expect(result.fulfilled).toBe(1);
    expect(result.rejected).toEqual([expect.stringMatching(/pending request already exists|Only active income/)]);
    expect(await prisma.incomeAdjustmentRequest.count({ where: { incomeId: saleId } })).toBe(1);
  });

  it('approves a refund request only once when two admins approve it at the same time', async () => {
    const { tenant, admin, agent, saleId } = await sale('race-approve');
    const prisma = loadPrisma();
    const secondAdmin = await createCaller({ tenantId: tenant.tenantId, userId: tenant.adminUserId, roles: ['Admin'] });
    const request = await agent.customerIncome.createAdjustmentRequest({
      type: 'refund',
      incomeId: saleId,
      reason: 'Race',
      refundCardNumber: '8600123412341234',
    });

    const result = outcome(await Promise.allSettled([
      admin.customerIncome.approveAdjustmentRequest({ requestId: request.id, reviewNote: 'first' }),
      secondAdmin.customerIncome.approveAdjustmentRequest({ requestId: request.id, reviewNote: 'second' }),
    ]));

    expect(result.fulfilled).toBe(1);
    expect(result.rejected).toEqual([expect.stringMatching(/already been reviewed|Only pending requests/)]);
    expect(await prisma.auditLog.count({
      where: { tenantId: tenant.tenantId, action: 'income_adjustment_request_approve', resourceId: request.id },
    })).toBe(1);
    expect((await prisma.income.findUniqueOrThrow({ where: { id: saleId } })).lifecycleStatus).toBe('refunded');
  });

  it('lets only one of a simultaneous approve and reject of the same request win', async () => {
    const { tenant, admin, agent, saleId } = await sale('race-approve-reject');
    const prisma = loadPrisma();
    const secondAdmin = await createCaller({ tenantId: tenant.tenantId, userId: tenant.adminUserId, roles: ['Admin'] });
    const request = await agent.customerIncome.createAdjustmentRequest({
      type: 'refund',
      incomeId: saleId,
      reason: 'Race',
      refundCardNumber: '8600123412341234',
    });

    const result = outcome(await Promise.allSettled([
      admin.customerIncome.approveAdjustmentRequest({ requestId: request.id }),
      secondAdmin.customerIncome.rejectAdjustmentRequest({ requestId: request.id }),
    ]));

    expect(result.fulfilled).toBe(1);

    const stored = await prisma.incomeAdjustmentRequest.findUniqueOrThrow({ where: { id: request.id } });
    const storedSale = await prisma.income.findUniqueOrThrow({ where: { id: saleId } });

    // The sale must match the request's final status: refunded with an approval, active with a rejection.
    expect(storedSale.lifecycleStatus).toBe(stored.status === 'approved' ? 'refunded' : 'active');
  });

  it('finalizes a bonus month once when two finalizes run at the same time, and both callers get the snapshot', async () => {
    const { tenant, admin, saleMonth } = await sale('race-finalize');
    const prisma = loadPrisma();
    const secondAdmin = await createCaller({ tenantId: tenant.tenantId, userId: tenant.adminUserId, roles: ['Admin'] });

    const result = await Promise.allSettled([
      admin.bonus.finalizeBonusMonth({ month: saleMonth }),
      secondAdmin.bonus.finalizeBonusMonth({ month: saleMonth }),
    ]);

    expect(outcome(result)).toEqual({ fulfilled: 2, rejected: [] });
    expect(await prisma.bonusMonthSnapshot.count({ where: { tenantId: tenant.tenantId } })).toBe(1);
  });

  it('two first sales for the same new customer number at once both succeed on one customer', async () => {
    const { tenant, admin, agent, saleId, saleDate } = await sale('race-new-customer');
    const prisma = loadPrisma();
    const { courseId, tariffId } = await prisma.income.findUniqueOrThrow({ where: { id: saleId }, select: { courseId: true, tariffId: true } });
    const customerNumber = String(800_000_000 + Math.floor(Math.random() * 99_999_999));
    const newSale = (caller: Caller) => caller.customerIncome.createIncome({
      entryDate: saleDate,
      managerUserId: tenant.agentUserId,
      customerNumber,
      customerName: 'Raced Customer',
      type: 'new_sale',
      courseId: courseId!,
      tariffId: tariffId!,
      coursePriceAmount: COURSE_PRICE,
      paymentAmount: FIRST_PAYMENT,
    });

    const result = await Promise.allSettled([newSale(agent), newSale(admin), newSale(agent)]);

    expect(outcome(result)).toEqual({ fulfilled: 3, rejected: [] });
    const customers = await prisma.customer.findMany({ where: { tenantId: tenant.tenantId, customerNumber } });

    expect(customers).toHaveLength(1);
    expect(await prisma.income.count({ where: { customerId: customers[0]!.id, type: 'new_sale' } })).toBe(3);
  });
});
