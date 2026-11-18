import type { JWTPayload } from '@dashboarduz/shared';

import type { InMemoryPrisma } from '../../../../__tests__/helpers/in-memory-prisma';
import { contextFor, createMoneyFixture, daysAgo, type MoneyFixture, seedCustomer, seedSaleChain } from '../../../../__tests__/helpers/money-fixtures';
import { telegramService } from '../../../../services/integrations/telegram';
import { customerIncomeRouter } from '../index';

let mockStore: InMemoryPrisma;

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual('@dashboarduz/db'),
  forTenant: () => mockStore.client(),
}));

const ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'PAYMENT_RETURN_GROUP_ID', 'REFUND_GROUP_ID', 'REFUND_GROUP_IDS', 'TARIFF_CHANGE_GROUP_ID'];

describe('refund and tariff-change Telegram delivery through the procedures', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let fixture: MoneyFixture;
  let send: jest.SpyInstance;
  let saleId: string;

  const caller = (userId: string, roles: JWTPayload['roles']) => customerIncomeRouter.createCaller(contextFor(fixture, userId, roles));
  const sentTo = () => send.mock.calls.map((call) => String(call[1]));
  const textSentTo = (chatId: string) => send.mock.calls.filter((call) => String(call[1]) === chatId).map((call) => String(call[2]));

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
    process.env.PAYMENT_RETURN_GROUP_ID = '-500';
    process.env.TARIFF_CHANGE_GROUP_ID = '-600';
    send = jest.spyOn(telegramService, 'sendMessage').mockResolvedValue({} as never);
    fixture = createMoneyFixture();
    mockStore = fixture.store;
    fixture.store.tables.get('User')!.forEach((user) => {
      if (user.id === fixture.financeId) user.telegramId = '7001';
      if (user.id === fixture.agentId) user.telegramId = '7002';
    });
    const customerId = seedCustomer(fixture, '998901234567', 'Ali Valiyev');

    ({ saleId } = seedSaleChain(fixture, { customerId, agreementAmount: 3_000_000, firstPayment: 1_200_000, entryDate: daysAgo(12) }));
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    jest.restoreAllMocks();
  });

  it('a refund request goes to the refund group and to every Finance user with Telegram', async () => {
    await caller(fixture.agentId, ['Agent']).createAdjustmentRequest({ type: 'refund', incomeId: saleId, refundCardNumber: '8600123412341234', reason: 'Moved abroad' });

    expect(sentTo()).toEqual(['-500', '7001']);
    expect(textSentTo('-500')[0]).toContain("1 200 000 so'm");
    expect(textSentTo('7001')[0]).toContain("Pul qaytarish uchun yangi so'rov");
  });

  it('approval tells the refund group and the requester; rejection tells only the requester', async () => {
    const first = await caller(fixture.agentId, ['Agent']).createAdjustmentRequest({ type: 'refund', incomeId: saleId, refundCardNumber: '8600123412341234' });

    send.mockClear();
    await caller(fixture.financeId, ['Finance']).approveAdjustmentRequest({ requestId: first.id });
    expect(sentTo()).toEqual(['-500', '7002']);
    expect(textSentTo('7002')[0]).toContain('✅ Pul qaytarildi');

    const customerId = seedCustomer(fixture, '998900000002');
    const other = seedSaleChain(fixture, { customerId, agreementAmount: 1_000_000, firstPayment: 400_000, entryDate: daysAgo(5) });
    const second = await caller(fixture.agentId, ['Agent']).createAdjustmentRequest({ type: 'refund', incomeId: other.saleId, refundCardNumber: '8600123412341234' });

    send.mockClear();
    await caller(fixture.adminId, ['Admin']).rejectAdjustmentRequest({ requestId: second.id, reviewNote: 'no' });
    expect(sentTo()).toEqual(['7002']);
    expect(textSentTo('7002')[0]).toContain('❌ Qaytarish rad etildi');
  });

  it('a Telegram failure never fails the request', async () => {
    send.mockRejectedValue(new Error('telegram down'));

    await expect(caller(fixture.agentId, ['Agent']).createAdjustmentRequest({ type: 'refund', incomeId: saleId, refundCardNumber: '8600123412341234' })).resolves.toMatchObject({ status: 'pending' });
    expect(fixture.store.rows('IncomeAdjustmentRequest')).toHaveLength(1);
  });

  it('a tariff-change request goes to the tariff-change group', async () => {
    await caller(fixture.agentId, ['Agent']).createAdjustmentRequest({
      type: 'tariff_change',
      incomeId: saleId,
      newCourseId: fixture.otherCourseId,
      newTariffId: fixture.otherTariffId,
      newAgreementAmount: 4_000_000,
    });

    expect(sentTo()).toEqual(['-600']);
    expect(textSentTo('-600')[0]).toContain("4 000 000 so'm");
  });
});
