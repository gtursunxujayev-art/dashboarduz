import type { CreateIncomeInput } from '@dashboarduz/shared';

import { createMoneyFixture, dayString, daysAgo, type MoneyFixture, seedCustomer, seedSaleChain } from '../../../__tests__/helpers/money-fixtures';
import { createIncomeEntry } from '../create-income';

function baseSale(fixture: MoneyFixture, overrides: Partial<CreateIncomeInput> = {}): CreateIncomeInput {
  return {
    type: 'new_sale',
    entryDate: dayString(daysAgo(3)),
    managerUserId: fixture.agentId,
    customerNumber: '998901112233',
    customerName: 'Ali Valiyev',
    courseId: fixture.courseId,
    tariffId: fixture.tariffId,
    coursePriceAmount: 3_000_000,
    paymentAmount: 1_000_000,
    ...overrides,
  };
}

function create(fixture: MoneyFixture, input: CreateIncomeInput, extra: { requesterRoles?: string[]; skipTelegramNotification?: boolean; writeAuditLog?: boolean } = {}) {
  return createIncomeEntry({
    tenantId: fixture.tenantId,
    userId: fixture.adminId,
    input,
    db: fixture.store.client(),
    skipTelegramNotification: true,
    ...extra,
  });
}

describe('createIncomeEntry: new sale', () => {
  let fixture: MoneyFixture;

  beforeEach(() => {
    fixture = createMoneyFixture();
  });

  it('creates the customer and a sale whose remaining debt is price minus first payment', async () => {
    const result = await create(fixture, baseSale(fixture, { deadline: dayString(daysAgo(-20)), telegramUsername: '@ali_v' }));

    expect(result.customerNumber).toBe('998901112233');
    expect(result.income).toMatchObject({
      type: 'new_sale',
      lifecycleStatus: 'active',
      coursePriceAmount: 3_000_000,
      debtAmount: 3_000_000,
      paymentAmount: 1_000_000,
      remainingDebtAmount: 2_000_000,
      managerUserId: fixture.agentId,
    });
    expect(result.income.deadline).toBeInstanceOf(Date);
    expect(result.telegramDispatch).toEqual({ attempted: false, delivered: false, sentCount: 0, failedCount: 0, reason: 'skipped_by_admin' });
    expect(result.chronologyDebug).toEqual({ incomeChainReorderedByDate: false, canonicalSaleIncomeId: null });

    const [customer] = fixture.store.rows('Customer');

    expect(customer).toMatchObject({ name: 'Ali Valiyev', telegramUsername: '@ali_v', profileCourseId: fixture.courseId, profileTariffId: fixture.tariffId });
    const [audit] = fixture.store.rows('AuditLog');

    expect(audit).toMatchObject({ action: 'income_create', resource: 'income', resourceId: result.income.id, metadata: { type: 'new_sale', customerNumber: '998901112233' } });
  });

  it('keeps only the digits of the customer number and strips invalid username characters', async () => {
    const result = await create(fixture, baseSale(fixture, { customerNumber: '+998 90-111-22-33', telegramUsername: ' ali.v! ' }));

    expect(result.customerNumber).toBe('998901112233');
    expect(fixture.store.rows('Customer')[0]).toMatchObject({ customerNumber: '998901112233', telegramUsername: 'aliv' });
  });

  it('drops the deadline of a sale paid in full', async () => {
    const result = await create(fixture, baseSale(fixture, { paymentAmount: 3_000_000, deadline: dayString(daysAgo(-20)) }));

    expect(result.income.remainingDebtAmount).toBe(0);
    expect(result.income.deadline).toBeNull();
  });

  it('keeps an overpayment as zero debt, never negative', async () => {
    const result = await create(fixture, baseSale(fixture, { paymentAmount: 3_500_000 }));

    expect(result.income.remainingDebtAmount).toBe(0);
    expect(result.income.paymentAmount).toBe(3_500_000);
  });

  it('reuses an existing customer by number and writes no audit log when asked', async () => {
    const customerId = seedCustomer(fixture, '998901112233', 'Existing name');
    const result = await create(fixture, baseSale(fixture, { customerName: undefined }), { writeAuditLog: false });

    expect(result.income.customerId).toBe(customerId);
    expect(fixture.store.rows('Customer')).toHaveLength(1);
    expect(fixture.store.rows('AuditLog')).toHaveLength(0);
    expect(result.telegramDispatch).toBeNull();
  });

  it('stores the chosen sub-tariff on the sale meta and the customer profile', async () => {
    const [subTariff] = fixture.store.seed('SubTariff', [{ tenantId: fixture.tenantId, tariffId: fixture.tariffId, name: 'Morning' }]);
    const result = await create(fixture, baseSale(fixture, { subTariffId: String(subTariff!.id) }));

    expect(result.income.legacyImportMeta).toEqual({ saleSubTariffId: subTariff!.id });
    expect(fixture.store.rows('Customer')[0]!.profileSubTariffId).toBe(subTariff!.id);
  });

  it.each([
    ['a future entry date', { entryDate: dayString(daysAgo(-2)) }, "Kelajakdagi sana kiritish mumkin emas. Bugungi yoki o'tgan sanani tanlang."],
    ['a customer number without digits', { customerNumber: 'abc-' }, 'Customer number must contain only digits.'],
    ['a Telegram username with an inner @', { telegramUsername: 'ali@v' }, 'Telegram username may contain only letters, digits, "_" and optional "@".'],
    ['a negative payment', { paymentAmount: -1 }, 'Payment amount cannot be negative.'],
    ['a new customer without a name', { customerName: '  ' }, 'Customer name is required for a new customer number.'],
    ['a sale without a course price', { coursePriceAmount: undefined }, 'Course, tariff, and course price are required for a new sale.'],
    ['a negative course price', { coursePriceAmount: -5 }, 'Course price cannot be negative.'],
    ['an unknown tariff', { tariffId: '00000000-0000-4000-8000-000000000000' }, 'Course or tariff not found.'],
  ])('rejects %s', async (_label, overrides, message) => {
    await expect(create(fixture, baseSale(fixture, overrides))).rejects.toThrow(message);
    expect(fixture.store.rows('Income')).toHaveLength(0);
  });

  it('rejects a course hidden from the income form unless hidden courses are allowed', async () => {
    fixture.store.tables.get('Course')!.forEach((course) => {
      course.isHiddenFromIncomeForm = true;
    });

    await expect(create(fixture, baseSale(fixture))).rejects.toThrow('Course or tariff not found.');
    const allowed = await createIncomeEntry({
      tenantId: fixture.tenantId,
      userId: fixture.adminId,
      input: baseSale(fixture),
      allowHiddenCourseSelection: true,
      skipTelegramNotification: true,
      db: fixture.store.client(),
    });

    expect(allowed.income.remainingDebtAmount).toBe(2_000_000);
  });

  it('requires a sub-tariff when the tariff has active ones, and only of that tariff', async () => {
    fixture.store.seed('SubTariff', [{ tenantId: fixture.tenantId, tariffId: fixture.tariffId, name: 'Evening' }]);
    const [foreign] = fixture.store.seed('SubTariff', [{ tenantId: fixture.tenantId, tariffId: fixture.otherTariffId, name: 'Weekend' }]);

    await expect(create(fixture, baseSale(fixture))).rejects.toThrow('Sub-tariff is required for the selected tariff.');
    await expect(create(fixture, baseSale(fixture, { subTariffId: String(foreign!.id) }))).rejects.toThrow('Sub-tariff not found for selected tariff.');
  });

  it('rejects a manager without a sales role, and an inactive one unless the requester may pick inactive managers', async () => {
    await expect(create(fixture, baseSale(fixture, { managerUserId: fixture.financeId }))).rejects.toThrow('Selected sales manager is not available.');

    fixture.store.tables.get('User')!.forEach((user) => {
      if (user.id === fixture.agentId) user.isActive = false;
    });
    await expect(create(fixture, baseSale(fixture), { requesterRoles: ['Manager'] })).rejects.toThrow('Selected sales manager is not available.');
    const byFinance = await create(fixture, baseSale(fixture), { requesterRoles: ['Finance'] });

    expect(byFinance.income.managerUserId).toBe(fixture.agentId);
  });

  it('reports a failed Telegram notification without failing the sale', async () => {
    const previousToken = process.env.TELEGRAM_BOT_TOKEN;

    delete process.env.TELEGRAM_BOT_TOKEN;
    try {
      const result = await create(fixture, baseSale(fixture), { skipTelegramNotification: false });

      expect(result.income.paymentAmount).toBe(1_000_000);
      expect(result.telegramDispatch?.delivered).toBe(false);
      expect(result.telegramDispatch?.sentCount).toBe(0);
    } finally {
      if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = previousToken;
    }
  });
});

describe('createIncomeEntry: repayment', () => {
  let fixture: MoneyFixture;
  let customerId: string;

  beforeEach(() => {
    fixture = createMoneyFixture();
    customerId = seedCustomer(fixture, '998907654321');
  });

  function repayment(overrides: Partial<CreateIncomeInput> = {}): CreateIncomeInput {
    return {
      type: 'repayment',
      entryDate: dayString(daysAgo(1)),
      managerUserId: fixture.agentId,
      customerNumber: '998907654321',
      paymentAmount: 500_000,
      ...overrides,
    };
  }

  it('records the debt before the payment and lowers the sale debt', async () => {
    const { saleId } = seedSaleChain(fixture, { customerId, agreementAmount: 3_000_000, firstPayment: 1_000_000, entryDate: daysAgo(10) });
    const result = await create(fixture, repayment({ debtSourceIncomeId: saleId }));

    expect(result.income).toMatchObject({
      type: 'repayment',
      relatedDebtIncomeId: saleId,
      debtAmount: 2_000_000,
      paymentAmount: 500_000,
      remainingDebtAmount: 1_500_000,
      courseId: fixture.courseId,
      tariffId: fixture.tariffId,
    });
    expect(fixture.store.rows('Income', { id: saleId })[0]!.remainingDebtAmount).toBe(1_500_000);
    expect(fixture.store.rawQueries.some((query) => /FOR UPDATE/.test(query.sql))).toBe(true);
  });

  it('picks the latest sale that still has debt when no debt source is given', async () => {
    seedSaleChain(fixture, { customerId, agreementAmount: 1_000_000, firstPayment: 1_000_000, entryDate: daysAgo(5) });
    const { saleId: olderWithDebt } = seedSaleChain(fixture, { customerId, agreementAmount: 2_000_000, firstPayment: 500_000, entryDate: daysAgo(20) });
    const result = await create(fixture, repayment({ paymentAmount: 1_500_000 }));

    expect(result.income.relatedDebtIncomeId).toBe(olderWithDebt);
    expect(result.income.remainingDebtAmount).toBe(0);
  });

  it('takes earlier repayments into account when computing the debt', async () => {
    const { saleId } = seedSaleChain(fixture, {
      customerId,
      agreementAmount: 3_000_000,
      firstPayment: 1_000_000,
      entryDate: daysAgo(30),
      repayments: [{ amount: 700_000, entryDate: daysAgo(20) }],
    });
    const result = await create(fixture, repayment({ debtSourceIncomeId: saleId, paymentAmount: 1_300_000 }));

    expect(result.income.debtAmount).toBe(1_300_000);
    expect(result.income.remainingDebtAmount).toBe(0);
    expect(fixture.store.rows('Income', { id: saleId })[0]!.remainingDebtAmount).toBe(0);
  });

  it('turns a repayment dated before its sale into the sale of the chain', async () => {
    const { saleId } = seedSaleChain(fixture, { customerId, agreementAmount: 3_000_000, firstPayment: 1_000_000, entryDate: daysAgo(10) });
    const result = await create(fixture, repayment({ debtSourceIncomeId: saleId, paymentAmount: 400_000, entryDate: dayString(daysAgo(15)) }));

    expect(result.chronologyDebug).toEqual({ incomeChainReorderedByDate: true, canonicalSaleIncomeId: result.income.id });
    expect(result.income).toMatchObject({ type: 'new_sale', relatedDebtIncomeId: null, coursePriceAmount: 3_000_000, paymentAmount: 400_000 });
    const formerSale = fixture.store.rows('Income', { id: saleId })[0]!;

    expect(formerSale).toMatchObject({ type: 'repayment', relatedDebtIncomeId: result.income.id, debtAmount: 2_600_000, remainingDebtAmount: 1_600_000 });
    expect(fixture.store.rows('AuditLog')[0]!.metadata).toEqual({
      type: 'repayment',
      customerNumber: '998907654321',
      mode: 'income_chain_reordered_by_date',
      canonicalSaleIncomeId: result.income.id,
    });
  });

  it.each([
    ['an unknown customer', { customerNumber: '111' }, 'Repayment can only be added for an existing customer debt.'],
    ['a customer without open debt', {}, 'Debt source is required for repayment.'],
  ])('rejects a repayment for %s', async (_label, overrides, message) => {
    seedSaleChain(fixture, { customerId, agreementAmount: 1_000_000, firstPayment: 1_000_000, entryDate: daysAgo(5) });
    await expect(create(fixture, repayment(overrides))).rejects.toThrow(message);
  });

  it('rejects a zero repayment, a repayment above the debt and a repayment on a closed sale', async () => {
    const { saleId } = seedSaleChain(fixture, { customerId, agreementAmount: 3_000_000, firstPayment: 1_000_000, entryDate: daysAgo(10) });
    const { saleId: closedSale } = seedSaleChain(fixture, { customerId, agreementAmount: 1_000_000, firstPayment: 1_000_000, entryDate: daysAgo(9) });

    await expect(create(fixture, repayment({ debtSourceIncomeId: saleId, paymentAmount: 0 }))).rejects.toThrow('Repayment amount must be greater than zero.');
    await expect(create(fixture, repayment({ debtSourceIncomeId: saleId, paymentAmount: 2_000_001 }))).rejects.toThrow('Repayment amount cannot exceed the selected debt.');
    await expect(create(fixture, repayment({ debtSourceIncomeId: closedSale }))).rejects.toThrow('Selected debt source has no remaining debt.');
    expect(fixture.store.rows('Income', { type: 'repayment' })).toHaveLength(0);
    expect(fixture.store.rows('Income', { id: saleId })[0]!.remainingDebtAmount).toBe(2_000_000);
  });

  it("rejects another customer's debt and a missing debt source", async () => {
    const otherCustomer = seedCustomer(fixture, '998900000001');
    const { saleId } = seedSaleChain(fixture, { customerId: otherCustomer, agreementAmount: 3_000_000, firstPayment: 1_000_000, entryDate: daysAgo(10) });

    await expect(create(fixture, repayment({ debtSourceIncomeId: saleId }))).rejects.toThrow('Selected debt does not belong to the selected customer.');
    await expect(create(fixture, repayment({ debtSourceIncomeId: '00000000-0000-4000-8000-000000000001' }))).rejects.toThrow('Selected debt source not found.');
  });
});
