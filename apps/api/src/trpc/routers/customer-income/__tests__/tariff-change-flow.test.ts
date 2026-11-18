import type { JWTPayload } from '@dashboarduz/shared';

import type { InMemoryPrisma } from '../../../../__tests__/helpers/in-memory-prisma';
import { contextFor, createMoneyFixture, daysAgo, type MoneyFixture, seedCustomer, seedSaleChain } from '../../../../__tests__/helpers/money-fixtures';
import { customerIncomeRouter } from '../index';

let mockStore: InMemoryPrisma;

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual('@dashboarduz/db'),
  forTenant: () => mockStore.client(),
}));

describe('tariff change requests', () => {
  let fixture: MoneyFixture;
  let customerId: string;
  let saleId: string;
  let repaymentIds: string[];
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;

  const caller = (userId: string, roles: JWTPayload['roles']) => customerIncomeRouter.createCaller(contextFor(fixture, userId, roles));
  const income = (id: string) => fixture.store.rows('Income', { id })[0]!;

  beforeAll(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  afterAll(() => {
    if (previousToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = previousToken;
  });

  beforeEach(() => {
    fixture = createMoneyFixture();
    mockStore = fixture.store;
    customerId = seedCustomer(fixture, '998935556677', 'Dilnoza');
    ({ saleId, repaymentIds } = seedSaleChain(fixture, {
      customerId,
      agreementAmount: 4_000_000,
      firstPayment: 1_000_000,
      entryDate: daysAgo(50),
      repayments: [
        { amount: 1_000_000, entryDate: daysAgo(30) },
        { amount: 500_000, entryDate: daysAgo(10) },
      ],
    }));
  });

  async function requestChange(newAgreementAmount: number) {
    return caller(fixture.agentId, ['Agent']).createAdjustmentRequest({
      type: 'tariff_change',
      incomeId: saleId,
      newCourseId: fixture.otherCourseId,
      newTariffId: fixture.otherTariffId,
      newAgreementAmount,
    });
  }

  it('records the target course, tariff and agreement without touching the chain', async () => {
    const created = await requestChange(6_000_000);

    expect(created).toMatchObject({ type: 'tariff_change', status: 'pending' });
    expect(fixture.store.rows('IncomeAdjustmentRequest')[0]).toMatchObject({
      incomeId: saleId,
      requestedAmount: null,
      refundCardNumber: null,
      newCourseId: fixture.otherCourseId,
      newTariffId: fixture.otherTariffId,
      newAgreementAmount: 6_000_000,
      previousCourseId: fixture.courseId,
      previousTariffId: fixture.tariffId,
    });
    expect(fixture.store.rows('Income').every((row) => row.lifecycleStatus === 'active')).toBe(true);
  });

  it('approval moves the chain to the new tariff and recomputes every debt from the new agreement', async () => {
    const { id } = await requestChange(6_000_000);

    await expect(caller(fixture.financeId, ['Finance']).approveAdjustmentRequest({ requestId: id })).rejects.toThrow(
      'Admin, Manager, Tashkiliy, or Organizator role is required to approve tariff changes.',
    );
    await caller(fixture.managerId, ['Manager']).approveAdjustmentRequest({ requestId: id });

    // Paid so far: 1 000 000 + 1 000 000 + 500 000 = 2 500 000 of the new 6 000 000.
    expect(income(saleId)).toMatchObject({ courseId: fixture.otherCourseId, tariffId: fixture.otherTariffId, coursePriceAmount: 6_000_000, debtAmount: 6_000_000, remainingDebtAmount: 3_500_000 });
    expect(income(repaymentIds[0]!)).toMatchObject({ courseId: fixture.otherCourseId, debtAmount: 5_000_000, remainingDebtAmount: 4_000_000 });
    expect(income(repaymentIds[1]!)).toMatchObject({ tariffId: fixture.otherTariffId, debtAmount: 4_000_000, remainingDebtAmount: 3_500_000 });
    expect(fixture.store.rows('IncomeAdjustmentRequest')[0]).toMatchObject({ status: 'approved', reviewedByUserId: fixture.managerId });
  });

  it('a lower agreement than already paid leaves no debt, never a negative one', async () => {
    const { id } = await requestChange(2_000_000);

    await caller(fixture.adminId, ['Admin']).approveAdjustmentRequest({ requestId: id });

    expect(income(saleId)).toMatchObject({ coursePriceAmount: 2_000_000, remainingDebtAmount: 0, deadline: null });
    expect(income(repaymentIds[0]!)).toMatchObject({ debtAmount: 1_000_000, remainingDebtAmount: 0 });
    expect(income(repaymentIds[1]!)).toMatchObject({ debtAmount: 0, remainingDebtAmount: 0 });
  });

  it('approval fails and rolls back when the target tariff was deactivated meanwhile', async () => {
    const { id } = await requestChange(6_000_000);

    fixture.store.tables.get('Tariff')!.forEach((tariff) => {
      if (tariff.id === fixture.otherTariffId) tariff.isActive = false;
    });

    await expect(caller(fixture.adminId, ['Admin']).approveAdjustmentRequest({ requestId: id })).rejects.toThrow(
      'Cannot apply tariff change: source/new course/new tariff is missing.',
    );
    expect(fixture.store.rows('IncomeAdjustmentRequest')[0]!.status).toBe('pending');
    expect(income(saleId)).toMatchObject({ courseId: fixture.courseId, coursePriceAmount: 4_000_000, remainingDebtAmount: 1_500_000 });
  });

  it('approval fails on a sale that is no longer active', async () => {
    const { id } = await requestChange(6_000_000);

    fixture.store.tables.get('Income')!.forEach((row) => {
      if (row.id === saleId) row.lifecycleStatus = 'refunded';
    });

    await expect(caller(fixture.adminId, ['Admin']).approveAdjustmentRequest({ requestId: id })).rejects.toThrow('Tariff change can be applied only to active income entries.');
  });

  it('a request without its targets cannot be approved', async () => {
    const { id } = await requestChange(6_000_000);

    fixture.store.tables.get('IncomeAdjustmentRequest')!.forEach((row) => {
      row.newAgreementAmount = null;
    });

    await expect(caller(fixture.adminId, ['Admin']).approveAdjustmentRequest({ requestId: id })).rejects.toThrow(
      'Tariff-change request does not have target course/tariff/agreement.',
    );
  });

  it('rejection leaves every income row unchanged', async () => {
    const before = fixture.store.rows('Income').map((row) => ({ ...row, updatedAt: null }));
    const { id } = await requestChange(6_000_000);

    await expect(caller(fixture.financeId, ['Finance']).rejectAdjustmentRequest({ requestId: id })).rejects.toThrow(
      'Admin, Manager, Tashkiliy, or Organizator role is required to reject tariff changes.',
    );
    await caller(fixture.managerId, ['Manager']).rejectAdjustmentRequest({ requestId: id });

    expect(fixture.store.rows('Income').map((row) => ({ ...row, updatedAt: null }))).toEqual(before);
    expect(fixture.store.rows('IncomeAdjustmentRequest')[0]!.status).toBe('rejected');
  });

  it.each([
    ['on a repayment', () => ({ incomeId: repaymentIds[0]! }), 'Tariff change is available only for new sale entries.'],
    ['without an agreement amount', () => ({ newAgreementAmount: undefined }), 'Course, tariff, and agreement amount are required for tariff change.'],
    ['to a tariff of another course', () => ({ newTariffId: fixture.tariffId }), 'Selected course/tariff was not found.'],
  ])('refuses a request %s', async (_label, overrides, message) => {
    await expect(caller(fixture.adminId, ['Admin']).createAdjustmentRequest({
      type: 'tariff_change',
      incomeId: saleId,
      newCourseId: fixture.otherCourseId,
      newTariffId: fixture.otherTariffId,
      newAgreementAmount: 6_000_000,
      ...overrides(),
    })).rejects.toThrow(message);
    expect(fixture.store.rows('IncomeAdjustmentRequest')).toHaveLength(0);
  });

  it('refuses a second pending request on the same sale', async () => {
    await requestChange(6_000_000);

    await expect(requestChange(7_000_000)).rejects.toThrow('A pending request already exists for this income entry.');
  });
});
