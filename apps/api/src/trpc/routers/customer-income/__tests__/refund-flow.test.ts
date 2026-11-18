import type { JWTPayload } from '@dashboarduz/shared';

import type { InMemoryPrisma } from '../../../../__tests__/helpers/in-memory-prisma';
import { contextFor, createMoneyFixture, daysAgo, type MoneyFixture, seedCustomer, seedSaleChain } from '../../../../__tests__/helpers/money-fixtures';
import { customerIncomeRouter } from '../index';

let mockStore: InMemoryPrisma;

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual('@dashboarduz/db'),
  forTenant: () => mockStore.client(),
}));

const CARD = '8600123412341234';

describe('refund requests: create, approve, reject', () => {
  let fixture: MoneyFixture;
  let customerId: string;
  let saleId: string;
  let repaymentId: string;
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;

  const caller = (userId: string, roles: JWTPayload['roles']) => customerIncomeRouter.createCaller(contextFor(fixture, userId, roles));

  beforeAll(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  afterAll(() => {
    if (previousToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = previousToken;
  });

  beforeEach(() => {
    fixture = createMoneyFixture();
    mockStore = fixture.store;
    customerId = seedCustomer(fixture, '998901234567', 'Ali Valiyev');
    const chain = seedSaleChain(fixture, {
      customerId,
      agreementAmount: 5_000_000,
      firstPayment: 2_000_000,
      entryDate: daysAgo(40),
      repayments: [{ amount: 1_000_000, entryDate: daysAgo(20) }],
    });

    saleId = chain.saleId;
    repaymentId = chain.repaymentIds[0]!;
  });

  const lifecycles = () => fixture.store.rows('Income').map((row) => [row.type, row.lifecycleStatus]);

  it('a refund request asks for everything paid on the chain and puts the whole chain on hold', async () => {
    const created = await caller(fixture.agentId, ['Agent']).createAdjustmentRequest({
      type: 'refund',
      incomeId: repaymentId,
      reason: '  Kursdan voz kechdi  ',
      refundCardNumber: CARD,
    });

    expect(created).toMatchObject({ type: 'refund', status: 'pending' });
    const [request] = fixture.store.rows('IncomeAdjustmentRequest');

    // Requested on the repayment, the refund is filed against the root sale.
    expect(request).toMatchObject({
      incomeId: saleId,
      customerId,
      requestedByUserId: fixture.agentId,
      reason: 'Kursdan voz kechdi',
      requestedAmount: 3_000_000,
      refundCardNumber: CARD,
      newCourseId: null,
      previousCourseId: fixture.courseId,
      previousTariffId: fixture.tariffId,
    });
    expect(lifecycles()).toEqual([['new_sale', 'pending_refund'], ['repayment', 'pending_refund']]);
    expect(fixture.store.rows('AuditLog')[0]).toMatchObject({ action: 'income_adjustment_request_create', resourceId: created.id, metadata: { incomeId: saleId, type: 'refund' } });
  });

  it('refuses a second request, a refund without a card and a request on a foreign agent sale', async () => {
    await expect(caller(fixture.agentId, ['Agent']).createAdjustmentRequest({ type: 'refund', incomeId: saleId })).rejects.toThrow("Pul qaytarish uchun 16 xonali karta raqami majburiy.");
    await expect(caller(fixture.otherAgentId, ['Agent']).createAdjustmentRequest({ type: 'refund', incomeId: saleId, refundCardNumber: CARD })).rejects.toThrow('Selected income was not found.');

    await caller(fixture.agentId, ['Agent']).createAdjustmentRequest({ type: 'refund', incomeId: saleId, refundCardNumber: CARD });
    // The chain is on hold now, so the fast-path status check stops a second request.
    await expect(caller(fixture.adminId, ['Admin']).createAdjustmentRequest({ type: 'refund', incomeId: saleId, refundCardNumber: CARD })).rejects.toThrow('Only active income entries can be adjusted.');
    expect(fixture.store.rows('IncomeAdjustmentRequest')).toHaveLength(1);
  });

  it('refuses a refund on a repayment whose sale link is missing', async () => {
    fixture.store.tables.get('Income')!.forEach((row) => {
      if (row.id === repaymentId) row.relatedDebtIncomeId = null;
    });

    await expect(caller(fixture.adminId, ['Admin']).createAdjustmentRequest({ type: 'refund', incomeId: repaymentId, refundCardNumber: CARD })).rejects.toThrow("Qarzdorlik to'lovi uchun asosiy sotuv topilmadi.");
  });

  it('approval by Finance marks every chain row refunded and records the reviewer', async () => {
    const { id } = await caller(fixture.agentId, ['Agent']).createAdjustmentRequest({ type: 'refund', incomeId: saleId, refundCardNumber: CARD });

    await expect(caller(fixture.agentId, ['Agent']).approveAdjustmentRequest({ requestId: id })).rejects.toThrow('Admin or Finance role is required to approve refunds.');
    await expect(caller(fixture.financeId, ['Finance']).approveAdjustmentRequest({ requestId: id, reviewNote: ' paid back ' })).resolves.toEqual({ success: true });

    expect(lifecycles()).toEqual([['new_sale', 'refunded'], ['repayment', 'refunded']]);
    expect(fixture.store.rows('IncomeAdjustmentRequest')[0]).toMatchObject({ status: 'approved', reviewedByUserId: fixture.financeId, reviewNote: 'paid back' });
    expect(fixture.store.rows('IncomeAdjustmentRequest')[0]!.reviewedAt).toBeInstanceOf(Date);
    expect(fixture.store.rows('AuditLog').map((log) => log.action)).toEqual(['income_adjustment_request_create', 'income_adjustment_request_approve']);

    await expect(caller(fixture.adminId, ['Admin']).approveAdjustmentRequest({ requestId: id })).rejects.toThrow('Only pending requests can be approved.');
    await expect(caller(fixture.adminId, ['Admin']).rejectAdjustmentRequest({ requestId: id })).rejects.toThrow('Only pending requests can be rejected.');
  });

  it('rejection restores the chain to active with its debts intact', async () => {
    const { id } = await caller(fixture.agentId, ['Agent']).createAdjustmentRequest({ type: 'refund', incomeId: saleId, refundCardNumber: CARD });

    await expect(caller(fixture.managerId, ['Manager']).rejectAdjustmentRequest({ requestId: id })).rejects.toThrow('Admin or Finance role is required to reject refunds.');
    await caller(fixture.adminId, ['Admin']).rejectAdjustmentRequest({ requestId: id, reviewNote: 'not eligible' });

    expect(lifecycles()).toEqual([['new_sale', 'active'], ['repayment', 'active']]);
    expect(fixture.store.rows('Income', { id: saleId })[0]!.remainingDebtAmount).toBe(2_000_000);
    expect(fixture.store.rows('IncomeAdjustmentRequest')[0]).toMatchObject({ status: 'rejected', reviewNote: 'not eligible', reviewedByUserId: fixture.adminId });
    expect(fixture.store.rows('Customer')[0]).toMatchObject({ profileCourseId: fixture.courseId, profileTariffId: fixture.tariffId });
  });

  it('a review that loses the race to another review fails and changes nothing', async () => {
    const { id } = await caller(fixture.agentId, ['Agent']).createAdjustmentRequest({ type: 'refund', incomeId: saleId, refundCardNumber: CARD });
    let raced = false;

    // Another reviewer claims the request between this review's status check and its transaction.
    fixture.store.beforeOperation = (modelName, operation) => {
      if (modelName !== 'IncomeAdjustmentRequest' || operation !== 'updateMany' || raced) return;
      raced = true;
      fixture.store.tables.get('IncomeAdjustmentRequest')!.forEach((row) => {
        row.status = 'rejected';
      });
    };

    await expect(caller(fixture.adminId, ['Admin']).approveAdjustmentRequest({ requestId: id })).rejects.toThrow('This request has already been reviewed.');
    expect(lifecycles()).toEqual([['new_sale', 'pending_refund'], ['repayment', 'pending_refund']]);
  });

  it('reports a missing request', async () => {
    const missing = '00000000-0000-4000-8000-000000000009';

    await expect(caller(fixture.adminId, ['Admin']).approveAdjustmentRequest({ requestId: missing })).rejects.toThrow('Request not found.');
    await expect(caller(fixture.adminId, ['Admin']).rejectAdjustmentRequest({ requestId: missing })).rejects.toThrow('Request not found.');
  });
});
