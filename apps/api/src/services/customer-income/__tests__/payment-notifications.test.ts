import { createMoneyFixture, type MoneyFixture, seedCustomer, seedSaleChain } from '../../../__tests__/helpers/money-fixtures';
import { telegramService } from '../../integrations/telegram';
import { formatDateGmt5, resolveRefundGroupIds, sendOfflineOrIntensivePaymentTelegram } from '../payment-notifications';

const ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'OFLINE_GROUP_ID', 'OFFLINE_GROUP_ID', 'OFLINE_GROUP_IDS', 'OFFLINE_GROUP_IDS', 'ONLINE_GROUP_ID', 'ONLINE_GROUP_IDS', 'REFUND_GROUP_ID', 'REFUND_GROUP_IDS', 'PAYMENT_RETURN_GROUP_ID'];

describe('payment notifications', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let fixture: MoneyFixture;
  let send: jest.SpyInstance;
  let saleId: string;
  let repaymentId: string;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
    process.env.OFLINE_GROUP_ID = '-1001, -1002';
    send = jest.spyOn(telegramService, 'sendMessage').mockResolvedValue({} as never);
    fixture = createMoneyFixture();
    const customerId = seedCustomer(fixture, '998901234567', 'Ali Valiyev');

    fixture.store.tables.get('Customer')![0]!.telegramUsername = 'ali_v';
    ({ saleId, repaymentIds: [repaymentId = ''] } = seedSaleChain(fixture, {
      customerId,
      agreementAmount: 3_000_000,
      firstPayment: 1_000_000,
      entryDate: new Date('2026-03-04T10:00:00Z'),
      repayments: [{ amount: 500_000, entryDate: new Date('2026-03-20T20:30:00Z') }],
    }));
    fixture.store.seed('SubTariff', [
      { tenantId: fixture.tenantId, tariffId: fixture.tariffId, name: 'Morning group' },
      { tenantId: fixture.tenantId, tariffId: fixture.tariffId, name: 'Evening group' },
    ]);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    jest.restoreAllMocks();
  });

  const dispatch = (incomeId: string, preferredSubTariffId?: string) => sendOfflineOrIntensivePaymentTelegram({ tenantId: fixture.tenantId, incomeId, preferredSubTariffId, db: fixture.store.client() });

  it('sends the whole payment history of an offline sale to every offline group', async () => {
    const result = await dispatch(repaymentId);

    expect(result).toEqual({ attempted: true, delivered: true, sentCount: 2, failedCount: 0, reason: undefined, errors: [] });
    expect(send.mock.calls.map((call) => call[1])).toEqual(['-1001', '-1002']);
    expect(send.mock.calls[0]![0]).toBe('bot-token');
    expect(send.mock.calls[0]![2]).toBe([
      '#Foundation_English',
      '#Standard',
      '#Evening_group',
      '#Aziz',
      '',
      '1.Mijoz: Ali Valiyev',
      '2.Tel: 998901234567',
      '3.Tg: @ali_v',
      '',
      "Narxi - 3 000 000 so'm",
      '',
      "To'lov:",
      '',
      "1) 1 000 000 so'm - 04.03.2026",
      "2) 500 000 so'm - 21.03.2026",
      '',
      "Qarz: 1 500 000 so'm",
      'Deadline: -',
      '',
      '@Moliya_b0limi',
      '@najotnur_oflayn',
    ].join('\n'));
  });

  it('uses the chosen sub-tariff hashtag when it belongs to the tariff', async () => {
    const morning = fixture.store.rows('SubTariff', { name: 'Morning group' })[0]!;

    await dispatch(saleId, String(morning.id));

    expect(String(send.mock.calls[0]![2]).split('\n')[2]).toBe('#Morning_group');
  });

  it('counts a group that fails as not delivered', async () => {
    send.mockRejectedValueOnce(new Error('chat not found'));

    const result = await dispatch(saleId);

    expect(result).toMatchObject({ attempted: true, delivered: true, sentCount: 1, failedCount: 1, errors: ['-1001: chat not found'] });
    send.mockRejectedValue(new Error('blocked'));
    expect(await dispatch(saleId)).toMatchObject({ delivered: false, sentCount: 0, failedCount: 2, reason: 'send_failed' });
  });

  it.each([
    ['no bot token', () => { delete process.env.TELEGRAM_BOT_TOKEN; }, 'bot_token_missing'],
    ['no offline group', () => { delete process.env.OFLINE_GROUP_ID; }, 'groups_missing'],
    ['an online course without an online group', () => {
      fixture.store.tables.get('Course')!.forEach((course) => { course.category = 'online'; });
    }, 'groups_missing'],
    ['a course of unknown category', () => {
      fixture.store.tables.get('Course')!.forEach((course) => { course.category = 'webinar'; });
    }, 'course_not_eligible'],
  ])('does not send with %s', async (_label, arrange, reason) => {
    arrange();

    expect(await dispatch(saleId)).toEqual({ attempted: false, delivered: false, sentCount: 0, failedCount: 0, reason });
    expect(send).not.toHaveBeenCalled();
  });

  it('reports an unknown income', async () => {
    expect(await dispatch('00000000-0000-4000-8000-000000000001')).toMatchObject({ attempted: false, reason: 'income_not_found' });
  });

  it('formats dates as the Tashkent calendar day and prefers the REFUND_GROUP ids', () => {
    expect(formatDateGmt5(new Date('2026-12-31T19:30:00Z'))).toBe('01.01.2027');
    process.env.PAYMENT_RETURN_GROUP_ID = '-300';
    expect(resolveRefundGroupIds()).toEqual(['-300']);
    process.env.REFUND_GROUP_IDS = '-100;-200';
    expect(resolveRefundGroupIds()).toEqual(['-100', '-200']);
  });
});
