import type { JWTPayload } from '@dashboarduz/shared';

import type { InMemoryPrisma } from '../../../../__tests__/helpers/in-memory-prisma';
import { contextFor, createMoneyFixture, dayString, daysAgo, type MoneyFixture, seedCustomer, seedSaleChain } from '../../../../__tests__/helpers/money-fixtures';
import * as bonusEngine from '../../../../services/bonus-engine';
import { customerIncomeRouter } from '../index';

let mockStore: InMemoryPrisma;

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual('@dashboarduz/db'),
  forTenant: () => mockStore.client(),
}));

const previousToken = process.env.TELEGRAM_BOT_TOKEN;

beforeAll(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
});

afterAll(() => {
  if (previousToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = previousToken;
});

let fixture: MoneyFixture;
let customerId: string;

const caller = (userId: string, roles: JWTPayload['roles']) => customerIncomeRouter.createCaller(contextFor(fixture, userId, roles));
const income = (id: string) => fixture.store.rows('Income', { id })[0]!;

beforeEach(() => {
  fixture = createMoneyFixture();
  mockStore = fixture.store;
  customerId = seedCustomer(fixture, '998971234567', 'Kamola');
});

describe('createIncome procedure', () => {
  const sale = () => ({
    type: 'new_sale' as const,
    entryDate: dayString(daysAgo(2)),
    managerUserId: fixture.agentId,
    customerNumber: '998971234567',
    courseId: fixture.courseId,
    tariffId: fixture.tariffId,
    coursePriceAmount: 2_400_000,
    paymentAmount: 400_000,
  });

  it('lets an agent record a sale for themselves and returns the chain debug', async () => {
    const result = await caller(fixture.agentId, ['Agent']).createIncome(sale());

    expect(result.income).toMatchObject({ customerId, paymentAmount: 400_000, remainingDebtAmount: 2_000_000 });
    expect(result.debug).toEqual({ incomeChainReorderedByDate: false, canonicalSaleIncomeId: null });
    // Agents cannot silence the Telegram notification; with no bot configured it is attempted and reported.
    expect(result.telegramDispatch?.reason).not.toBe('skipped_by_admin');
  });

  it('refuses an agent recording a sale for another agent', async () => {
    await expect(caller(fixture.agentId, ['Agent']).createIncome({ ...sale(), managerUserId: fixture.otherAgentId })).rejects.toThrow(
      'You can create income records only for yourself.',
    );
  });

  it('lets an admin record for any agent and skip the notification', async () => {
    const result = await caller(fixture.adminId, ['Admin']).createIncome({ ...sale(), managerUserId: fixture.otherAgentId, skipTelegramNotification: true });

    expect(result.income.managerUserId).toBe(fixture.otherAgentId);
    expect(result.telegramDispatch).toEqual({ attempted: false, delivered: false, sentCount: 0, failedCount: 0, reason: 'skipped_by_admin' });
  });

  it('refuses a deactivated caller', async () => {
    fixture.store.tables.get('User')!.forEach((user) => {
      if (user.id === fixture.adminId) user.isActive = false;
    });

    await expect(caller(fixture.adminId, ['Admin']).createIncome(sale())).rejects.toThrow('User is deactivated');
  });
});

describe('deleteIncome procedure', () => {
  it('is admin only', async () => {
    const { saleId } = seedSaleChain(fixture, { customerId, agreementAmount: 1_000_000, firstPayment: 1_000_000, entryDate: daysAgo(3) });

    await expect(caller(fixture.agentId, ['Agent']).deleteIncome({ incomeId: saleId })).rejects.toThrow('Admin access required');
  });

  it('refuses to delete a sale that has repayments, then deletes the repayment and recomputes the chain', async () => {
    const { saleId, repaymentIds } = seedSaleChain(fixture, {
      customerId,
      agreementAmount: 3_000_000,
      firstPayment: 1_000_000,
      entryDate: daysAgo(30),
      repayments: [{ amount: 500_000, entryDate: daysAgo(20) }, { amount: 700_000, entryDate: daysAgo(10) }],
    });
    const admin = caller(fixture.adminId, ['Admin']);

    await expect(admin.deleteIncome({ incomeId: saleId })).rejects.toThrow('This sale has repayments. Delete repayments first.');
    await expect(admin.deleteIncome({ incomeId: repaymentIds[0]! })).resolves.toEqual({ success: true });

    // Without the 500 000 payment the later repayment now starts from a 2 000 000 debt.
    expect(income(repaymentIds[1]!)).toMatchObject({ debtAmount: 2_000_000, remainingDebtAmount: 1_300_000 });
    expect(income(saleId).remainingDebtAmount).toBe(1_300_000);
    expect(fixture.store.rows('AuditLog')[0]).toMatchObject({ action: 'income_delete', resourceId: repaymentIds[0], metadata: { type: 'repayment' } });
  });

  it('refuses an entry with a pending adjustment request and a missing entry', async () => {
    const { saleId } = seedSaleChain(fixture, { customerId, agreementAmount: 1_000_000, firstPayment: 500_000, entryDate: daysAgo(3) });

    fixture.store.seed('IncomeAdjustmentRequest', [{
      tenantId: fixture.tenantId,
      type: 'refund',
      incomeId: saleId,
      customerId,
      requestedByUserId: fixture.agentId,
    }]);

    await expect(caller(fixture.adminId, ['Admin']).deleteIncome({ incomeId: saleId })).rejects.toThrow(
      'This income entry has pending adjustment requests. Resolve them first.',
    );
    await expect(caller(fixture.adminId, ['Admin']).deleteIncome({ incomeId: '00000000-0000-4000-8000-0000000000aa' })).rejects.toThrow('Income entry not found.');
  });

  it('deletes a sale without repayments', async () => {
    const { saleId } = seedSaleChain(fixture, { customerId, agreementAmount: 1_000_000, firstPayment: 500_000, entryDate: daysAgo(3) });

    await caller(fixture.adminId, ['Admin']).deleteIncome({ incomeId: saleId });

    expect(fixture.store.rows('Income')).toHaveLength(0);
  });
});

describe('updateIncome procedure: sale rows', () => {
  let saleId: string;
  let repaymentIds: string[];

  beforeEach(() => {
    ({ saleId, repaymentIds } = seedSaleChain(fixture, {
      customerId,
      agreementAmount: 3_000_000,
      firstPayment: 1_000_000,
      entryDate: daysAgo(30),
      repayments: [{ amount: 500_000, entryDate: daysAgo(20) }],
    }));
  });

  it('recomputes the sale and every repayment from a new agreement and first payment', async () => {
    const result = await caller(fixture.adminId, ['Admin']).updateIncome({ incomeId: saleId, coursePriceAmount: 4_000_000, paymentAmount: 1_500_000 });

    expect(result.success).toBe(true);
    expect(result.debug).toEqual({ incomeChainReorderedByDate: false, canonicalSaleIncomeId: null });
    expect(income(saleId)).toMatchObject({ coursePriceAmount: 4_000_000, debtAmount: 4_000_000, paymentAmount: 1_500_000, remainingDebtAmount: 2_000_000 });
    expect(income(repaymentIds[0]!)).toMatchObject({ debtAmount: 2_500_000, remainingDebtAmount: 2_000_000 });
    expect(fixture.store.rows('AuditLog')[0]).toMatchObject({ action: 'income_update', metadata: { type: 'new_sale', mode: 'new_sale' } });
  });

  it('moves the chain to another course and tariff and records a sub-tariff', async () => {
    const [subTariff] = fixture.store.seed('SubTariff', [{ tenantId: fixture.tenantId, tariffId: fixture.otherTariffId, name: 'Evening' }]);

    await caller(fixture.adminId, ['Admin']).updateIncome({
      incomeId: saleId,
      courseId: fixture.otherCourseId,
      tariffId: fixture.otherTariffId,
      subTariffId: String(subTariff!.id),
    });

    expect(income(saleId)).toMatchObject({ courseId: fixture.otherCourseId, tariffId: fixture.otherTariffId, legacyImportMeta: { saleSubTariffId: subTariff!.id } });
    expect(income(repaymentIds[0]!)).toMatchObject({ courseId: fixture.otherCourseId, tariffId: fixture.otherTariffId });
    expect(fixture.store.rows('Customer')[0]).toMatchObject({ profileCourseId: fixture.otherCourseId, profileTariffId: fixture.otherTariffId, profileSubTariffId: subTariff!.id });
  });

  it('re-orders the chain when the sale is moved after its repayment', async () => {
    const result = await caller(fixture.adminId, ['Admin']).updateIncome({ incomeId: saleId, entryDate: dayString(daysAgo(10)) });

    expect(result.debug).toEqual({ incomeChainReorderedByDate: true, canonicalSaleIncomeId: repaymentIds[0] });
    expect(income(repaymentIds[0]!)).toMatchObject({ type: 'new_sale', relatedDebtIncomeId: null, coursePriceAmount: 3_000_000, paymentAmount: 500_000, remainingDebtAmount: 1_500_000 });
    expect(income(saleId)).toMatchObject({ type: 'repayment', relatedDebtIncomeId: repaymentIds[0], debtAmount: 2_500_000, remainingDebtAmount: 1_500_000 });
  });

  it.each([
    ['an agreement below what was paid', () => ({ coursePriceAmount: 1_400_000 }), 'Agreement amount cannot be less than total paid amount for this sale.'],
    ['a future entry date', () => ({ entryDate: dayString(daysAgo(-3)) }), "Kelajakdagi sana kiritish mumkin emas. Bugungi yoki o'tgan sanani tanlang."],
    ['an unknown tariff', () => ({ tariffId: '00000000-0000-4000-8000-0000000000bb' }), 'Course or tariff not found.'],
    ['a manager outside sales', () => ({ managerUserId: fixture.financeId }), 'Selected sales manager is not available.'],
  ])('refuses %s and leaves the chain as it was', async (_label, overrides, message) => {
    await expect(caller(fixture.adminId, ['Admin']).updateIncome({ incomeId: saleId, ...overrides() })).rejects.toThrow(message);
    expect(income(saleId)).toMatchObject({ coursePriceAmount: 3_000_000, paymentAmount: 1_000_000, remainingDebtAmount: 1_500_000 });
  });

  it('refuses an edit when the chain changed since it was read', async () => {
    let changed = false;

    // Another writer changes a payment between the read and the transaction's chain lock.
    fixture.store.rawQueryHandler = (_sql, _values, db) => {
      if (!changed) {
        changed = true;
        db.tables.get('Income')!.forEach((row) => {
          if (row.id === repaymentIds[0]) row.paymentAmount = 600_000;
        });
      }

      return [];
    };

    await expect(caller(fixture.adminId, ['Admin']).updateIncome({ incomeId: saleId, paymentAmount: 1_200_000 })).rejects.toThrow(
      "Bu yozuv hozirgina boshqa foydalanuvchi tomonidan o'zgartirildi. Sahifani yangilab, qayta urinib ko'ring.",
    );
    expect(income(saleId).paymentAmount).toBe(1_000_000);
  });

  it('refuses rows that are not active or have a pending request', async () => {
    fixture.store.seed('IncomeAdjustmentRequest', [{ tenantId: fixture.tenantId, type: 'tariff_change', incomeId: saleId, customerId, requestedByUserId: fixture.agentId }]);

    await expect(caller(fixture.adminId, ['Admin']).updateIncome({ incomeId: saleId, paymentAmount: 1 })).rejects.toThrow(
      'This income entry has pending adjustment requests. Resolve them first.',
    );
    fixture.store.tables.get('Income')!.forEach((row) => {
      row.lifecycleStatus = 'refunded';
    });
    await expect(caller(fixture.adminId, ['Admin']).updateIncome({ incomeId: saleId, paymentAmount: 1 })).rejects.toThrow('Only active income entries can be edited.');
    await expect(caller(fixture.adminId, ['Admin']).updateIncome({ incomeId: '00000000-0000-4000-8000-0000000000cc' })).rejects.toThrow('Income entry not found.');
  });

  it('reconciles finalized bonus months after a sale edit and clears the reconcile it asked for', async () => {
    const reconcile = jest.spyOn(bonusEngine, 'reconcileFinalizedBonusMonths').mockResolvedValue(0);

    await caller(fixture.adminId, ['Admin']).updateIncome({ incomeId: saleId, paymentAmount: 1_200_000 });

    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ tenantId: fixture.tenantId, actorUserId: fixture.adminId }));
    expect(fixture.store.rows('BonusReconcileRequest')).toHaveLength(0);
    reconcile.mockRestore();
  });

  it('keeps the edit and records a reconcile to retry when reconciling fails', async () => {
    const reconcile = jest.spyOn(bonusEngine, 'reconcileFinalizedBonusMonths').mockRejectedValue(new Error('bonus db timeout'));

    await caller(fixture.adminId, ['Admin']).updateIncome({ incomeId: saleId, paymentAmount: 1_200_000 });

    expect(income(saleId).paymentAmount).toBe(1_200_000);
    expect(fixture.store.rows('BonusReconcileRequest')).toEqual([
      expect.objectContaining({ tenantId: fixture.tenantId, reason: 'updateIncome', attempts: 1, lastError: 'bonus db timeout' }),
    ]);
    reconcile.mockRestore();
  });
});

describe('updateIncome procedure: repayment rows', () => {
  let saleId: string;
  let repaymentIds: string[];

  beforeEach(() => {
    ({ saleId, repaymentIds } = seedSaleChain(fixture, {
      customerId,
      agreementAmount: 3_000_000,
      firstPayment: 1_000_000,
      entryDate: daysAgo(30),
      repayments: [{ amount: 500_000, entryDate: daysAgo(20) }, { amount: 300_000, entryDate: daysAgo(10) }],
    }));
  });

  it('changes the payment and carries the difference through the rest of the chain', async () => {
    const result = await caller(fixture.adminId, ['Admin']).updateIncome({ incomeId: repaymentIds[0]!, paymentAmount: 800_000, managerUserId: fixture.otherAgentId });

    expect(result.income).toMatchObject({ paymentAmount: 800_000, debtAmount: 2_000_000, remainingDebtAmount: 1_200_000, managerUserId: fixture.otherAgentId });
    expect(income(repaymentIds[1]!)).toMatchObject({ debtAmount: 1_200_000, remainingDebtAmount: 900_000 });
    expect(income(saleId).remainingDebtAmount).toBe(900_000);
    expect(fixture.store.rows('AuditLog')[0]).toMatchObject({ metadata: { type: 'repayment', mode: 'repayment' } });
  });

  it('re-orders the chain when a repayment is dated before its sale', async () => {
    const result = await caller(fixture.adminId, ['Admin']).updateIncome({ incomeId: repaymentIds[1]!, entryDate: dayString(daysAgo(40)) });

    expect(result.debug).toEqual({ incomeChainReorderedByDate: true, canonicalSaleIncomeId: repaymentIds[1] });
    expect(income(repaymentIds[1]!)).toMatchObject({ type: 'new_sale', coursePriceAmount: 3_000_000, remainingDebtAmount: 1_200_000 });
    expect(income(saleId)).toMatchObject({ type: 'repayment', relatedDebtIncomeId: repaymentIds[1], debtAmount: 2_700_000, remainingDebtAmount: 1_700_000 });
  });

  it.each([
    ['a course change', { courseId: '00000000-0000-4000-8000-0000000000dd' }, 'Repayment rows do not support course or tariff edits.'],
    ['a zero payment', { paymentAmount: 0 }, 'Repayment amount must be greater than zero.'],
    ['a payment above the debt it paid', { paymentAmount: 2_000_001 }, 'Repayment amount cannot exceed source debt.'],
  ])('refuses %s', async (_label, overrides, message) => {
    await expect(caller(fixture.adminId, ['Admin']).updateIncome({ incomeId: repaymentIds[0]!, ...overrides })).rejects.toThrow(message);
    expect(income(repaymentIds[0]!).paymentAmount).toBe(500_000);
  });

  it('refuses a repayment without a sale link', async () => {
    fixture.store.tables.get('Income')!.forEach((row) => {
      if (row.id === repaymentIds[0]) row.relatedDebtIncomeId = null;
    });

    await expect(caller(fixture.adminId, ['Admin']).updateIncome({ incomeId: repaymentIds[0]!, paymentAmount: 400_000 })).rejects.toThrow(
      'This repayment does not have a source debt.',
    );
  });
});
