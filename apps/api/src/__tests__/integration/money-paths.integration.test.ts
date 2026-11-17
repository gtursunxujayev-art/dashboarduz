/**
 * Money-path integration tests: real Postgres, real tRPC procedures, one throwaway tenant per test.
 * Skipped automatically unless TEST_DATABASE_URL is set (see ./harness.ts).
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

type SaleFixture = {
  tenant: TestTenant;
  admin: Caller;
  agent: Caller;
  courseId: string;
  tariffId: string;
  saleId: string;
  customerNumber: string;
  saleDate: string;
  saleMonth: string;
};

const COURSE_PRICE = 3_000_000;
const FIRST_PAYMENT = 1_000_000;

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
    customerName: 'Integration Customer',
    type: 'new_sale',
    courseId: course.id,
    tariffId: tariff.id,
    coursePriceAmount: COURSE_PRICE,
    paymentAmount: FIRST_PAYMENT,
  });

  return {
    tenant,
    admin,
    agent,
    courseId: course.id,
    tariffId: tariff.id,
    saleId: created.income.id,
    customerNumber,
    saleDate,
    saleMonth,
  };
}

describeWithDatabase('money paths (Postgres integration)', () => {
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

  it('creates a new sale with the remaining debt and links the customer', async () => {
    const { tenant, saleId, customerNumber, courseId, tariffId } = await sale('new-sale');
    const prisma = loadPrisma();

    const income = await prisma.income.findUniqueOrThrow({ where: { id: saleId }, include: { customer: true } });

    expect(income).toMatchObject({
      tenantId: tenant.tenantId,
      type: 'new_sale',
      lifecycleStatus: 'active',
      managerUserId: tenant.agentUserId,
      courseId,
      tariffId,
      coursePriceAmount: COURSE_PRICE,
      debtAmount: COURSE_PRICE,
      paymentAmount: FIRST_PAYMENT,
      remainingDebtAmount: COURSE_PRICE - FIRST_PAYMENT,
    });
    expect(income.customer).toMatchObject({ tenantId: tenant.tenantId, customerNumber, name: 'Integration Customer' });
  });

  it('records a repayment against the debt and reduces what is owed', async () => {
    const { tenant, agent, saleId, customerNumber, saleDate } = await sale('repayment');
    const prisma = loadPrisma();

    const repayment = await agent.customerIncome.createIncome({
      entryDate: saleDate,
      managerUserId: tenant.agentUserId,
      customerNumber,
      type: 'repayment',
      debtSourceIncomeId: saleId,
      paymentAmount: 500_000,
    });

    const stored = await prisma.income.findUniqueOrThrow({ where: { id: repayment.income.id } });

    expect(stored).toMatchObject({
      type: 'repayment',
      relatedDebtIncomeId: saleId,
      paymentAmount: 500_000,
      remainingDebtAmount: COURSE_PRICE - FIRST_PAYMENT - 500_000,
    });

    const debts = await agent.customerIncome.customerOutstandingDebts({ customerNumber });
    const debtForSale = JSON.stringify(debts);

    expect(debtForSale).toContain(saleId);
    expect(debtForSale).toContain(String(COURSE_PRICE - FIRST_PAYMENT - 500_000));

    await expect(
      agent.customerIncome.createIncome({
        entryDate: saleDate,
        managerUserId: tenant.agentUserId,
        customerNumber,
        type: 'repayment',
        debtSourceIncomeId: saleId,
        paymentAmount: COURSE_PRICE,
      }),
    ).rejects.toThrow('Repayment amount cannot exceed the selected debt.');
  });

  it('refunds a sale and its repayments only after an Admin approves the request', async () => {
    const { tenant, admin, agent, saleId, customerNumber, saleDate } = await sale('refund');
    const prisma = loadPrisma();

    const repayment = await agent.customerIncome.createIncome({
      entryDate: saleDate,
      managerUserId: tenant.agentUserId,
      customerNumber,
      type: 'repayment',
      debtSourceIncomeId: saleId,
      paymentAmount: 250_000,
    });

    const request = await agent.customerIncome.createAdjustmentRequest({
      type: 'refund',
      incomeId: saleId,
      reason: 'Customer cancelled',
      refundCardNumber: '8600123412341234',
    });
    const requestId = request.id;

    // Pending: nothing is refunded yet.
    expect((await prisma.income.findUniqueOrThrow({ where: { id: saleId } })).lifecycleStatus).not.toBe('refunded');

    await expect(agent.customerIncome.approveAdjustmentRequest({ requestId })).rejects.toThrow(
      'Admin or Finance role is required to approve refunds.',
    );

    await admin.customerIncome.approveAdjustmentRequest({ requestId, reviewNote: 'ok' });

    const [storedSale, storedRepayment, storedRequest] = await Promise.all([
      prisma.income.findUniqueOrThrow({ where: { id: saleId } }),
      prisma.income.findUniqueOrThrow({ where: { id: repayment.income.id } }),
      prisma.incomeAdjustmentRequest.findUniqueOrThrow({ where: { id: requestId } }),
    ]);

    expect(storedSale.lifecycleStatus).toBe('refunded');
    expect(storedRepayment.lifecycleStatus).toBe('refunded');
    expect(storedRequest).toMatchObject({ status: 'approved', reviewedByUserId: tenant.adminUserId, reviewNote: 'ok' });

    await expect(admin.customerIncome.approveAdjustmentRequest({ requestId })).rejects.toThrow(
      'Only pending requests can be approved.',
    );
  });

  it('returns the refund card number only to Admin and Finance', async () => {
    const { tenant, admin, agent, saleId } = await sale('refund-card');
    const finance = await createCaller({ tenantId: tenant.tenantId, userId: tenant.adminUserId, roles: ['Finance'] });

    await agent.customerIncome.createAdjustmentRequest({
      type: 'refund',
      incomeId: saleId,
      reason: 'Card visibility',
      refundCardNumber: '8600123412341234',
    });

    const cardsSeenBy = async (caller: Caller) => (await caller.customerIncome.listAdjustmentRequests())
      .filter((request) => request.income.id === saleId)
      .map((request) => request.refundCardNumber);

    expect(await cardsSeenBy(admin)).toEqual(['8600123412341234']);
    expect(await cardsSeenBy(finance)).toEqual(['8600123412341234']);
    expect(await cardsSeenBy(agent)).toEqual([null]);
  });

  it('moves a sale to a new tariff and agreement after approval, keeping payments', async () => {
    const { tenant, admin, agent, saleId, customerNumber, saleDate, courseId } = await sale('tariff-change');
    const prisma = loadPrisma();

    await agent.customerIncome.createIncome({
      entryDate: saleDate,
      managerUserId: tenant.agentUserId,
      customerNumber,
      type: 'repayment',
      debtSourceIncomeId: saleId,
      paymentAmount: 400_000,
    });

    const premium = await admin.customerIncome.createTariff({ courseId, name: 'Premium' });
    const newAgreement = 4_000_000;
    const request = await agent.customerIncome.createAdjustmentRequest({
      type: 'tariff_change',
      incomeId: saleId,
      reason: 'Upgrade',
      newCourseId: courseId,
      newTariffId: premium.id,
      newAgreementAmount: newAgreement,
    });
    const requestId = request.id;

    await admin.customerIncome.approveAdjustmentRequest({ requestId });

    const storedSale = await prisma.income.findUniqueOrThrow({ where: { id: saleId } });

    expect(storedSale).toMatchObject({
      lifecycleStatus: 'active',
      tariffId: premium.id,
      coursePriceAmount: newAgreement,
      debtAmount: newAgreement,
      paymentAmount: FIRST_PAYMENT,
      remainingDebtAmount: newAgreement - FIRST_PAYMENT - 400_000,
    });
    const repayments = await prisma.income.findMany({ where: { relatedDebtIncomeId: saleId, type: 'repayment' } });

    expect(repayments.map((row) => row.tariffId)).toEqual([premium.id]);
  });

  it('finalizes a bonus month into a frozen snapshot that matches the preview', async () => {
    const { tenant, admin, saleMonth } = await sale('bonus-finalize');
    const prisma = loadPrisma();

    const simple = (simplePercent: number) => ({ mode: 'simple' as const, simplePercent, tiers: [] });

    await admin.bonus.updateBonusRules({
      bonusMode: 'on_income',
      bonusRules: { online: simple(10), offline: simple(0), intensive: simple(0), additional_service: simple(0) },
    });

    const preview = await admin.bonus.previewBonusMonth({ month: saleMonth });
    const finalized = await admin.bonus.finalizeBonusMonth({ month: saleMonth });

    // 10% of the 1,000,000 paid on the online sale.
    expect(preview.totalBonusAmount).toBe(FIRST_PAYMENT / 10);
    expect(finalized.month).toBe(saleMonth);
    expect(finalized.totalBonusAmount).toBe(preview.totalBonusAmount);

    const snapshots = await prisma.bonusMonthSnapshot.findMany({
      where: { tenantId: tenant.tenantId },
      include: { lines: true },
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.totalBonusAmount).toBe(preview.totalBonusAmount);
    expect(snapshots[0]!.finalizedByUserId).toBe(tenant.adminUserId);
    expect(snapshots[0]!.lines.reduce((sum, line) => sum + line.bonusAmount, 0)).toBe(preview.totalBonusAmount);

    // Finalizing again is idempotent: same snapshot, no duplicate.
    const again = await admin.bonus.finalizeBonusMonth({ month: saleMonth });

    expect(again.totalBonusAmount).toBe(preview.totalBonusAmount);
    expect(await prisma.bonusMonthSnapshot.count({ where: { tenantId: tenant.tenantId } })).toBe(1);

    // The current month is still open and cannot be frozen.
    const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    await expect(admin.bonus.finalizeBonusMonth({ month: currentMonth })).rejects.toThrow(
      'Only completed months can be finalized.',
    );
  });

  it('turns a refund in an already finalized month into a pending bonus adjustment, not a silent change', async () => {
    const { tenant, admin, agent, saleId, saleMonth } = await sale('bonus-refund');
    const prisma = loadPrisma();
    const simple = (simplePercent: number) => ({ mode: 'simple' as const, simplePercent, tiers: [] });

    await admin.bonus.updateBonusRules({
      bonusMode: 'on_income',
      bonusRules: { online: simple(10), offline: simple(0), intensive: simple(0), additional_service: simple(0) },
    });
    await admin.bonus.finalizeBonusMonth({ month: saleMonth });

    const request = await agent.customerIncome.createAdjustmentRequest({
      type: 'refund',
      incomeId: saleId,
      reason: 'Refund after payout',
      refundCardNumber: '8600123412341234',
    });

    await admin.customerIncome.approveAdjustmentRequest({ requestId: request.id });

    const snapshot = await prisma.bonusMonthSnapshot.findFirstOrThrow({ where: { tenantId: tenant.tenantId } });

    expect(snapshot.totalBonusAmount).toBe(FIRST_PAYMENT / 10);

    const adjustments = await prisma.bonusAdjustment.findMany({ where: { tenantId: tenant.tenantId } });

    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({
      snapshotId: snapshot.id,
      agentUserId: tenant.agentUserId,
      deltaAmount: -(FIRST_PAYMENT / 10),
      status: 'pending',
    });
  });

  it('keeps tenants isolated: another tenant cannot see or refund the sale', async () => {
    const { saleId, customerNumber } = await sale('isolation-owner');
    const other = await createTestTenant('isolation-other');

    tenantsToClean.push(other.tenantId);
    const otherAdmin = await createCaller({ tenantId: other.tenantId, userId: other.adminUserId, roles: ['Admin'] });

    const debts = await otherAdmin.customerIncome.customerOutstandingDebts({ customerNumber });

    expect(JSON.stringify(debts)).not.toContain(saleId);
    await expect(
      otherAdmin.customerIncome.createAdjustmentRequest({ type: 'refund', incomeId: saleId, reason: 'x' }),
    ).rejects.toThrow('Selected income was not found.');
  });
});
