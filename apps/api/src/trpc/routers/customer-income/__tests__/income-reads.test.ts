import type { JWTPayload } from '@dashboarduz/shared';

import type { InMemoryPrisma } from '../../../../__tests__/helpers/in-memory-prisma';
import { contextFor, createMoneyFixture, dayString, daysAgo, type MoneyFixture, seedCustomer, seedSaleChain } from '../../../../__tests__/helpers/money-fixtures';
import { customerIncomeRouter } from '../index';

let mockStore: InMemoryPrisma;

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual('@dashboarduz/db'),
  forTenant: () => mockStore.client(),
}));

let fixture: MoneyFixture;
let ali: string;
let vali: string;
let aliSale: { saleId: string; repaymentIds: string[] };
let valiSale: { saleId: string; repaymentIds: string[] };
let subTariffId: string;

const caller = (userId: string, roles: JWTPayload['roles']) => customerIncomeRouter.createCaller(contextFor(fixture, userId, roles));
const admin = () => caller(fixture.adminId, ['Admin']);
const agent = () => caller(fixture.agentId, ['Agent']);

beforeEach(() => {
  fixture = createMoneyFixture();
  mockStore = fixture.store;
  ali = seedCustomer(fixture, '998901111111', 'Ali Valiyev');
  vali = seedCustomer(fixture, '998902222222', 'Vali Aliyev');
  subTariffId = String(fixture.store.seed('SubTariff', [{ tenantId: fixture.tenantId, tariffId: fixture.tariffId, name: 'Morning' }])[0]!.id);
  // Aziz sold Ali 3 000 000 (1 000 000 paid); Bobur took a 500 000 repayment on it. Bobur sold Vali 2 000 000, paid in full.
  aliSale = seedSaleChain(fixture, {
    customerId: ali,
    agreementAmount: 3_000_000,
    firstPayment: 1_000_000,
    entryDate: daysAgo(20),
    repayments: [{ amount: 500_000, entryDate: daysAgo(10), managerUserId: fixture.otherAgentId }],
  });
  valiSale = seedSaleChain(fixture, { customerId: vali, managerUserId: fixture.otherAgentId, agreementAmount: 2_000_000, firstPayment: 2_000_000, entryDate: daysAgo(5), courseId: fixture.otherCourseId, tariffId: fixture.otherTariffId });
  fixture.store.tables.get('Income')!.forEach((row) => {
    if (row.id === aliSale.saleId) row.legacyImportMeta = { saleSubTariffId: subTariffId };
  });
  fixture.store.seed('AuditLog', [{ tenantId: fixture.tenantId, userId: fixture.financeId, action: 'income_create', resource: 'income', resourceId: aliSale.saleId }]);
});

describe('income lists', () => {
  it('lists the newest incomes with who created them and the effective sub-tariff', async () => {
    const rows = await admin().listIncomes();

    expect(rows.map((row) => row.id)).toEqual([valiSale.saleId, aliSale.repaymentIds[0], aliSale.saleId]);
    const sale = rows.find((row) => row.id === aliSale.saleId)!;

    expect(sale).toMatchObject({ createdByLabel: 'Feruza', effectiveSubTariffId: subTariffId, lifecycleStatus: 'active', customer: { name: 'Ali Valiyev' }, course: { name: 'Foundation English' } });
    expect(rows.find((row) => row.id === valiSale.saleId)!.createdByLabel).toBe('qo‘lda');
  });

  it('searches by customer name or number and scopes an agent to their own rows', async () => {
    expect((await admin().listIncomes({ query: 'vali aliyev', limit: 10 })).map((row) => row.id)).toEqual([valiSale.saleId]);
    expect((await admin().listIncomes({ query: '1111', limit: 10 })).map((row) => row.id)).toEqual([aliSale.repaymentIds[0], aliSale.saleId]);
    expect((await agent().listIncomes()).map((row) => row.id)).toEqual([aliSale.saleId]);
  });

  it('exports a date range with the agreement only on sale rows', async () => {
    const result = await admin().exportIncomesByDateRange({ dateFrom: dayString(daysAgo(15)), dateTo: dayString(daysAgo(0)) });

    expect(result.totalCount).toBe(2);
    expect(result.rows.map((row) => [row.type, row.customerName, row.managerLabel, row.agreementAmount, row.paymentAmount, row.remainingDebtAmount])).toEqual([
      ['new_sale', 'Vali Aliyev', 'Bobur', 2_000_000, 2_000_000, 0],
      ['repayment', 'Ali Valiyev', 'Bobur', null, 500_000, 1_500_000],
    ]);
    const all = await admin().exportIncomesByDateRange({ dateFrom: dayString(daysAgo(30)), dateTo: dayString(daysAgo(0)) });

    expect(all.rows.find((row) => row.id === aliSale.saleId)).toMatchObject({ subTariffName: 'Morning', tariffName: 'Standard', agreementAmount: 3_000_000 });
    await expect(admin().exportIncomesByDateRange({ dateFrom: dayString(daysAgo(1)), dateTo: dayString(daysAgo(5)) })).rejects.toThrow(
      "Boshlanish sanasi tugash sanasidan keyin bo'lishi mumkin emas.",
    );
    await expect(agent().exportIncomesByDateRange({ dateFrom: dayString(daysAgo(1)), dateTo: dayString(daysAgo(0)) })).rejects.toThrow('Admin access required');
  });

  it('lists adjustable sales with everything paid on each chain', async () => {
    const result = await admin().listAdjustableIncomes({ customerId: ali });

    expect(result.customer.customerNumber).toBe('998901111111');
    expect(result.incomes).toHaveLength(1);
    expect(result.incomes[0]).toMatchObject({ id: aliSale.saleId, paymentAmount: 1_500_000, managerLabel: 'Aziz', canCreateRequest: true, canChangeTariff: true });
    // An agent sees only the payments they took on the chain.
    expect((await agent().listAdjustableIncomes({ customerId: ali })).incomes[0]!.paymentAmount).toBe(1_000_000);
    await expect(agent().listAdjustableIncomes({ customerId: vali })).rejects.toThrow('Customer not found.');
  });
});

describe('customer payment history', () => {
  it('lists course sales and payments, found by id or customer number', async () => {
    const byNumber = await admin().customerPaymentHistory({ customerId: '998901111111' });

    expect(byNumber.customer.id).toBe(ali);
    expect(byNumber.courses).toEqual([expect.objectContaining({
      saleIncomeId: aliSale.saleId,
      courseName: 'Foundation English',
      tariffName: 'Standard',
      subTariffName: 'Morning',
      agreementAmount: 3_000_000,
      firstPaymentAmount: 1_000_000,
      remainingDebtAmount: 1_500_000,
      managerLabel: 'Aziz',
    })]);
    expect(byNumber.payments.map((payment) => [payment.type, payment.paymentAmount, payment.subTariffName, payment.managerLabel, payment.debtSourceIncomeId])).toEqual([
      ['repayment', 500_000, 'Morning', 'Bobur', aliSale.saleId],
      ['new_sale', 1_000_000, 'Morning', 'Aziz', aliSale.saleId],
    ]);
    expect((await admin().customerPaymentHistory({ customerId: ali })).payments).toHaveLength(2);
  });

  it('hides other agents customers and reports unknown ones', async () => {
    await expect(agent().customerPaymentHistory({ customerId: vali })).rejects.toThrow('Customer not found.');
    await expect(admin().customerPaymentHistory({ customerId: '  ' })).rejects.toThrow('Customer id is required.');
    expect((await agent().customerPaymentHistory({ customerId: ali })).payments.map((payment) => payment.paymentAmount)).toEqual([1_000_000]);
  });
});

describe('income form options', () => {
  it('offers sales managers, customers, the visible catalog and open debts', async () => {
    fixture.store.seed('Course', [{ tenantId: fixture.tenantId, name: 'Hidden course', isHiddenFromIncomeForm: true }]);
    const options = await admin().formOptions();

    expect(options.managers.map((manager) => manager.label)).toEqual(['Admin', 'Aziz', 'Bobur', 'Malika']);
    expect(options.customers.map((customer) => [customer.name, customer.responsibleManagerLabel])).toEqual(
      expect.arrayContaining([['Ali Valiyev', 'Bobur'], ['Vali Aliyev', 'Bobur']]),
    );
    expect(options.courses.map((course) => course.name)).toEqual(['Foundation English', 'IELTS Intensive']);
    expect(options.outstandingDebts).toEqual([expect.objectContaining({ id: aliSale.saleId, remainingDebtAmount: 1_500_000, debtAmount: 3_000_000, customerName: 'Ali Valiyev' })]);
  });

  it('marks inactive managers for roles that may still pick them', async () => {
    fixture.store.tables.get('User')!.forEach((user) => {
      if (user.id === fixture.otherAgentId) user.isActive = false;
    });

    expect((await caller(fixture.financeId, ['Finance']).formOptions()).managers.map((manager) => manager.label)).toContain('Bobur (Nofaol)');
    expect((await caller(fixture.managerId, ['Manager']).formOptions()).managers.map((manager) => manager.label)).not.toContain('Bobur (Nofaol)');
    expect((await agent().formOptions()).managers.map((manager) => manager.id)).toEqual([fixture.agentId]);
  });

  it('searches customers and lists outstanding debts by customer number', async () => {
    expect((await admin().searchCustomers({ query: 'VALI ALIYEV', limit: 5 })).map((customer) => customer.name)).toEqual(['Vali Aliyev']);
    expect((await agent().searchCustomers({ limit: 5 })).map((customer) => [customer.name, customer.responsibleManagerUserId])).toEqual([['Ali Valiyev', fixture.agentId]]);

    expect(await admin().customerOutstandingDebts({ customerNumber: '+998 90 111-11-11' })).toEqual([{
      id: aliSale.saleId,
      remainingDebtAmount: 1_500_000,
      debtAmount: 3_000_000,
      customerNumber: '998901111111',
      customerName: 'Ali Valiyev',
      courseName: 'Foundation English',
      tariffName: 'Standard',
    }]);
    expect(await admin().customerOutstandingDebts({ customerNumber: '998902222222' })).toEqual([]);
    expect(await admin().customerOutstandingDebts({ customerNumber: 'abc' })).toEqual([]);
  });
});

describe('adjustment request lists', () => {
  beforeEach(() => {
    fixture.store.seed('IncomeAdjustmentRequest', [
      { tenantId: fixture.tenantId, type: 'refund', incomeId: aliSale.saleId, customerId: ali, requestedByUserId: fixture.agentId, requestedAmount: 1_500_000, refundCardNumber: '8600123412341234', createdAt: daysAgo(2) },
      { tenantId: fixture.tenantId, type: 'tariff_change', incomeId: valiSale.saleId, customerId: vali, requestedByUserId: fixture.otherAgentId, newCourseId: fixture.courseId, newTariffId: fixture.tariffId, newAgreementAmount: 2_500_000, createdAt: daysAgo(1) },
    ]);
    fixture.store.tables.get('Customer')!.forEach((customer) => {
      if (customer.id === vali) customer.profileSubTariffId = String(fixture.store.seed('SubTariff', [{ tenantId: fixture.tenantId, tariffId: fixture.otherTariffId, name: 'morning ' }])[0]!.id);
    });
  });

  it('shows Admin everything, with the card number and an inferred sub-tariff for the new tariff', async () => {
    const requests = await admin().listAdjustmentRequests();

    expect(requests.map((request) => [request.type, request.requestedByLabel, request.income.managerLabel])).toEqual([
      ['tariff_change', 'Bobur', 'Bobur'],
      ['refund', 'Aziz', 'Aziz'],
    ]);
    expect(requests[0]).toMatchObject({ inferredNewSubTariffName: 'morning ', income: { profileSubTariffName: 'morning ' }, newTariff: { name: 'Standard' } });
    expect(requests[1]).toMatchObject({ refundCardNumber: '8600123412341234', requestedAmount: 1_500_000, reviewedByLabel: null });
  });

  it('limits Finance to refunds without hiding the card, and a Manager to tariff changes', async () => {
    const finance = await caller(fixture.financeId, ['Finance']).listAdjustmentRequests();
    const manager = await caller(fixture.managerId, ['Manager']).listAdjustmentRequests();

    expect(finance.map((request) => request.type)).toEqual(['refund']);
    expect(finance[0]!.refundCardNumber).toBe('8600123412341234');
    expect(manager.map((request) => [request.type, request.refundCardNumber])).toEqual([['tariff_change', null]]);
    await expect(caller(fixture.financeId, ['Finance']).listAdjustmentRequests({ type: 'tariff_change' })).rejects.toThrow('You do not have access to this request type.');
  });

  it('shows an agent only their own or their sales requests, without the card number', async () => {
    const requests = await agent().listAdjustmentRequests({ status: 'pending' });

    expect(requests.map((request) => [request.type, request.refundCardNumber])).toEqual([['refund', null]]);
    expect(await agent().listAdjustmentRequests({ status: 'approved' })).toEqual([]);
  });

  it('counts pending requests per type within the viewer scope', async () => {
    expect(await admin().adjustmentBadgeCount()).toEqual({ pendingTotal: 2, pendingRefund: 1, pendingTariffChange: 1, scopedToApproverQueue: true });
    expect(await caller(fixture.otherAgentId, ['Agent']).adjustmentBadgeCount()).toEqual({ pendingTotal: 1, pendingRefund: 0, pendingTariffChange: 1, scopedToApproverQueue: false });
  });

  it('keeps the per-type badge counts inside the role type guard', async () => {
    expect(await caller(fixture.financeId, ['Finance']).adjustmentBadgeCount()).toEqual({ pendingTotal: 1, pendingRefund: 1, pendingTariffChange: 0, scopedToApproverQueue: true });
  });
});
