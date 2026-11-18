import type { JWTPayload } from '@dashboarduz/shared';

import type { InMemoryPrisma } from '../../../../__tests__/helpers/in-memory-prisma';
import { contextFor, createMoneyFixture, daysAgo, type MoneyFixture, seedCustomer, seedSaleChain } from '../../../../__tests__/helpers/money-fixtures';
import * as bonusEngine from '../../../../services/bonus-engine';
import { getTashkentMonthKey, getTashkentMonthStart } from '../../../../services/bonus-engine';
import { customerIncomeRouter } from '../index';

let mockStore: InMemoryPrisma;

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual('@dashboarduz/db'),
  forTenant: () => mockStore.client(),
}));

let fixture: MoneyFixture;
let subTariffId: string;

const caller = (userId: string, roles: JWTPayload['roles']) => customerIncomeRouter.createCaller(contextFor(fixture, userId, roles));
const admin = () => caller(fixture.adminId, ['Admin']);

beforeEach(() => {
  fixture = createMoneyFixture();
  mockStore = fixture.store;
  subTariffId = String(fixture.store.seed('SubTariff', [{ tenantId: fixture.tenantId, tariffId: fixture.tariffId, name: 'Morning' }])[0]!.id);
});

describe('createCustomerOnly', () => {
  it('creates a customer with a normalized number and an optional course profile', async () => {
    const created = await admin().createCustomerOnly({
      customerNumber: ' +998 (90) 123-45-67 ',
      name: '  Ali  ',
      telegramUsername: '@ali_v',
      courseId: fixture.courseId,
      tariffId: fixture.tariffId,
      subTariffId,
    });

    expect(created).toMatchObject({ customerNumber: '998901234567', name: 'Ali', telegramUsername: '@ali_v', profileCourseId: fixture.courseId, profileTariffId: fixture.tariffId, profileSubTariffId: subTariffId });
    expect(fixture.store.rows('AuditLog')[0]).toMatchObject({ action: 'customer_create_only', resourceId: created.id, metadata: { customerNumber: '998901234567' } });
  });

  it.each([
    ['a number without digits', () => ({ customerNumber: 'abc' }), 'Customer number must contain only digits.'],
    ['a blank name', () => ({ name: '   ' }), 'Customer name is required.'],
    ['a username with an inner @', () => ({ telegramUsername: 'a@b' }), 'Telegram username may contain only letters, digits, "_" and optional "@".'],
    ['a tariff without a course', () => ({ tariffId: fixture.tariffId }), 'Course is required when selecting tariff or sub-tariff.'],
    ['a sub-tariff without a tariff', () => ({ courseId: fixture.courseId, subTariffId }), 'Tariff is required when selecting sub-tariff.'],
    ['an unknown course', () => ({ courseId: '00000000-0000-4000-8000-000000000001' }), 'Selected course not found.'],
    ['a tariff of another course', () => ({ courseId: fixture.otherCourseId, tariffId: fixture.tariffId }), 'Selected tariff not found for course.'],
    ['a foreign sub-tariff', () => ({ courseId: fixture.otherCourseId, tariffId: fixture.otherTariffId, subTariffId }), 'Selected sub-tariff not found for tariff.'],
  ])('refuses %s', async (_label, overrides, message) => {
    await expect(admin().createCustomerOnly({ customerNumber: '998900000001', name: 'Ali', ...overrides() })).rejects.toThrow(message);
    expect(fixture.store.rows('Customer')).toHaveLength(0);
  });

  it('refuses a number that already exists', async () => {
    seedCustomer(fixture, '998900000001');

    await expect(admin().createCustomerOnly({ customerNumber: '998900000001', name: 'Ali' })).rejects.toThrow('Customer with this number already exists.');
  });
});

describe('updateCustomerIdentity', () => {
  it('renames and renumbers a customer and records both versions', async () => {
    const customerId = seedCustomer(fixture, '998900000001', 'Old');
    const updated = await admin().updateCustomerIdentity({ customerId, customerNumber: '99890-000-00-02', name: ' New ' });

    expect(updated).toEqual({ id: customerId, customerNumber: '998900000002', name: 'New' });
    expect(fixture.store.rows('AuditLog')[0]!.metadata).toEqual({ previousCustomerNumber: '998900000001', previousName: 'Old', customerNumber: '998900000002', name: 'New' });
  });

  it('refuses a number taken by another customer and an unknown customer', async () => {
    const customerId = seedCustomer(fixture, '998900000001');

    seedCustomer(fixture, '998900000002');
    await expect(admin().updateCustomerIdentity({ customerId, customerNumber: '998900000002', name: 'X' })).rejects.toThrow('Another customer with this number already exists.');
    await expect(admin().updateCustomerIdentity({ customerId: '00000000-0000-4000-8000-000000000001', customerNumber: '1', name: 'X' })).rejects.toThrow('Customer not found.');
    // Keeping the own number is fine.
    await expect(admin().updateCustomerIdentity({ customerId, customerNumber: '998900000001', name: 'Same' })).resolves.toMatchObject({ name: 'Same' });
  });
});

describe('updateCustomersCourseAssignment', () => {
  it('moves the profiles and the active chains to the new course without touching amounts', async () => {
    const ali = seedCustomer(fixture, '998900000001');
    const vali = seedCustomer(fixture, '998900000002');
    const aliChain = seedSaleChain(fixture, { customerId: ali, agreementAmount: 2_000_000, firstPayment: 500_000, entryDate: daysAgo(10), repayments: [{ amount: 500_000, entryDate: daysAgo(5) }] });

    seedSaleChain(fixture, { customerId: vali, agreementAmount: 1_000_000, firstPayment: 1_000_000, entryDate: daysAgo(3), lifecycleStatus: 'refunded' });

    const result = await admin().updateCustomersCourseAssignment({ customerIds: [ali, vali, ali], courseId: fixture.otherCourseId, tariffId: fixture.otherTariffId });

    expect(result).toEqual({ updatedCount: 2, updatedSalesCount: 1, updatedRepaymentsCount: 1 });
    expect(fixture.store.rows('Income', { customerId: ali }).map((row) => [row.courseId, row.tariffId, row.remainingDebtAmount])).toEqual([
      [fixture.otherCourseId, fixture.otherTariffId, 1_000_000],
      [fixture.otherCourseId, fixture.otherTariffId, 1_000_000],
    ]);
    expect(fixture.store.rows('Income', { customerId: vali })[0]!.courseId).toBe(fixture.courseId);
    expect(fixture.store.rows('Customer').map((customer) => customer.profileCourseId)).toEqual([fixture.otherCourseId, fixture.otherCourseId]);
    expect(fixture.store.rows('AuditLog')[0]!.metadata).toMatchObject({ customerCount: 2, updatedCount: 2, updatedSalesCount: 1, updatedRepaymentsCount: 1 });
    expect(aliChain.repaymentIds).toHaveLength(1);
  });

  it('clearing the course only clears the profiles', async () => {
    const ali = seedCustomer(fixture, '998900000001');

    seedSaleChain(fixture, { customerId: ali, agreementAmount: 2_000_000, firstPayment: 500_000, entryDate: daysAgo(10) });
    await expect(admin().updateCustomersCourseAssignment({ customerIds: [ali], courseId: null })).resolves.toEqual({ updatedCount: 1, updatedSalesCount: 0, updatedRepaymentsCount: 0 });
    expect(fixture.store.rows('Income')[0]!.courseId).toBe(fixture.courseId);
    expect(fixture.store.rows('Customer')[0]!.profileCourseId).toBeNull();
  });

  it('refuses scopes that do not exist', async () => {
    const ali = seedCustomer(fixture, '998900000001');

    await expect(admin().updateCustomersCourseAssignment({ customerIds: [ali], tariffId: fixture.tariffId })).rejects.toThrow('Course is required when selecting tariff or sub-tariff.');
    await expect(admin().updateCustomersCourseAssignment({ customerIds: [ali], courseId: fixture.courseId, subTariffId })).rejects.toThrow('Tariff is required when selecting sub-tariff.');
    await expect(admin().updateCustomersCourseAssignment({ customerIds: [ali], courseId: fixture.courseId, tariffId: fixture.otherTariffId })).rejects.toThrow('Selected tariff not found for course.');
    await expect(admin().updateCustomersCourseAssignment({ customerIds: [ali], courseId: '00000000-0000-4000-8000-000000000001' })).rejects.toThrow('Selected course not found.');
    await expect(admin().updateCustomersCourseAssignment({ customerIds: [ali], courseId: fixture.otherCourseId, tariffId: fixture.otherTariffId, subTariffId })).rejects.toThrow(
      'Selected sub-tariff not found for tariff.',
    );
  });
});

describe('deleteCustomers and editor options', () => {
  const empty = { deletedCount: 0, deletedIds: [], deletedIncomeCount: 0, deletedRequestCount: 0 };

  it('deletes only existing customers of this tenant and reports the counts', async () => {
    const ali = seedCustomer(fixture, '998900000001');
    const [otherTenant] = fixture.store.seed('Tenant', [{ name: 'Other' }]);
    const foreign = String(fixture.store.seed('Customer', [{ tenantId: otherTenant!.id, customerNumber: '998900000009', name: 'Foreign' }])[0]!.id);

    await expect(admin().deleteCustomers({ customerIds: [ali, foreign, '00000000-0000-4000-8000-000000000001'] }))
      .resolves.toEqual({ deletedCount: 1, deletedIds: [ali], deletedIncomeCount: 0, deletedRequestCount: 0 });
    expect(fixture.store.rows('Customer', { id: foreign })).toHaveLength(1);
    expect(fixture.store.rows('AuditLog')[0]!.metadata).toMatchObject({ requestedCount: 3, deletedCount: 1, deletedIds: [ali] });
    await expect(admin().deleteCustomers({ customerIds: [ali] })).resolves.toEqual(empty);
    await expect(caller(fixture.agentId, ['Agent']).deleteCustomers({ customerIds: [ali] })).rejects.toThrow('Admin access required');
  });

  it('deletes a customer with its sales, repayments and requests, and audits ids and totals per customer', async () => {
    const paying = seedCustomer(fixture, '998900000002');
    const other = seedCustomer(fixture, '998900000003');
    const { saleId, repaymentIds } = seedSaleChain(fixture, {
      customerId: paying, agreementAmount: 1_000_000, firstPayment: 400_000, entryDate: daysAgo(10), repayments: [{ amount: 250_000, entryDate: daysAgo(5) }],
    });
    const kept = seedSaleChain(fixture, { customerId: other, agreementAmount: 500_000, firstPayment: 500_000, entryDate: daysAgo(4) });

    fixture.store.seed('IncomeAdjustmentRequest', [{ tenantId: fixture.tenantId, incomeId: saleId, customerId: paying, type: 'refund', status: 'pending', requestedByUserId: fixture.adminId }]);

    await expect(admin().deleteCustomers({ customerIds: [paying] }))
      .resolves.toEqual({ deletedCount: 1, deletedIds: [paying], deletedIncomeCount: 2, deletedRequestCount: 1 });
    expect(fixture.store.rows('Customer').map((row) => row.id)).toEqual([other]);
    expect(fixture.store.rows('Income').map((row) => row.id)).toEqual([kept.saleId]);
    expect(fixture.store.rows('Income', { id: { in: [saleId, ...repaymentIds] } })).toEqual([]);
    expect(fixture.store.rows('IncomeAdjustmentRequest')).toEqual([]);
    expect(fixture.store.rows('AuditLog')[0]!.metadata).toMatchObject({
      deletedIds: [paying],
      deletedIncomeCount: 2,
      deletedRequestCount: 1,
      paymentTotal: 650_000,
      customers: [{ id: paying, incomeCount: 2, requestCount: 1, paymentTotal: 650_000 }],
    });
  });

  it('writes a bonus reconcile marker for a finalized month that lost incomes, kept for retry when reconciling fails', async () => {
    const reconcile = jest.spyOn(bonusEngine, 'reconcileFinalizedBonusMonths').mockRejectedValue(new Error('bonus busy'));
    const paying = seedCustomer(fixture, '998900000004');
    const entryDate = daysAgo(40);

    seedSaleChain(fixture, { customerId: paying, agreementAmount: 1_000_000, firstPayment: 1_000_000, entryDate });
    fixture.store.seed('BonusMonthSnapshot', [{ tenantId: fixture.tenantId, month: getTashkentMonthStart(entryDate), policy: {}, sourceDigest: 'd', totalBonusAmount: 0, finalizedByUserId: fixture.adminId }]);

    await admin().deleteCustomers({ customerIds: [paying] });

    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ tenantId: fixture.tenantId }));
    expect(fixture.store.rows('BonusReconcileRequest')).toEqual([
      expect.objectContaining({ reason: `deleteCustomers:${getTashkentMonthKey(entryDate)}`, attempts: 1, lastError: 'bonus busy' }),
    ]);
    expect(fixture.store.rows('AuditLog')[0]!.metadata).toMatchObject({ finalizedMonthsAffected: [getTashkentMonthKey(entryDate)] });
    reconcile.mockRestore();
  });

  it('rolls everything back when a step fails mid-way', async () => {
    const paying = seedCustomer(fixture, '998900000005');

    seedSaleChain(fixture, { customerId: paying, agreementAmount: 1_000_000, firstPayment: 400_000, entryDate: daysAgo(3), repayments: [{ amount: 100_000, entryDate: daysAgo(2) }] });
    fixture.store.beforeOperation = (modelName, operation) => {
      if (modelName === 'Customer' && operation === 'deleteMany') throw new Error('connection lost');
    };

    await expect(admin().deleteCustomers({ customerIds: [paying] })).rejects.toThrow('connection lost');
    fixture.store.beforeOperation = null;
    expect(fixture.store.rows('Customer', { id: paying })).toHaveLength(1);
    expect(fixture.store.rows('Income', { customerId: paying })).toHaveLength(2);
    expect(fixture.store.rows('AuditLog')).toEqual([]);
  });

  it('refuses when a payment of another customer is linked to one of these sales', async () => {
    const paying = seedCustomer(fixture, '998900000006');
    const other = seedCustomer(fixture, '998900000007');
    const { repaymentIds } = seedSaleChain(fixture, { customerId: paying, agreementAmount: 1_000_000, firstPayment: 400_000, entryDate: daysAgo(3), repayments: [{ amount: 100_000, entryDate: daysAgo(2) }] });

    fixture.store.tables.get('Income')!.forEach((row) => {
      if (row.id === repaymentIds[0]) row.customerId = other;
    });

    await expect(admin().deleteCustomers({ customerIds: [paying] })).rejects.toThrow("1 ta boshqa mijozning to'lovi shu sotuvlarga bog'langan.");
    expect(fixture.store.rows('Income')).toHaveLength(2);
  });

  it('lists active courses with their active sub-tariffs for the editor', async () => {
    fixture.store.seed('SubTariff', [{ tenantId: fixture.tenantId, tariffId: fixture.tariffId, name: 'Old', isActive: false }]);
    const options = await admin().customerEditorOptions();
    const english = options.find((course) => course.name === 'Foundation English')!;

    expect(options.map((course) => course.name)).toEqual(['Foundation English', 'IELTS Intensive']);
    expect(english.tariffs.map((tariff) => [tariff.name, tariff.subTariffs.map((subTariff) => subTariff.name)])).toEqual([['Standard', ['Morning']]]);
  });
});
