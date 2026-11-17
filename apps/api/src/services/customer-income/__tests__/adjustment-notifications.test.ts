import type { DbClient } from '@dashboarduz/db';

import { telegramService } from '../../integrations/telegram';
import { notifyRefundRequesterReviewResult, sendRefundApprovedTelegram, sendRefundRequestedTelegram } from '../refund-notifications';
import { sendTariffChangeRequestedTelegram } from '../tariff-change-notifications';

const income = {
  id: 'sale-1',
  entryDate: new Date('2026-03-04T10:00:00+05:00'),
  paymentAmount: 1500000,
  customer: { name: 'Ali Valiyev', customerNumber: '998901234567', telegramUsername: 'ali_v' },
  manager: { name: 'Olim Karimov', username: 'olim' },
  course: { name: 'Foundation English', category: 'offline' },
  tariff: { name: 'VIP' },
};

function fakeDb(request: Record<string, unknown>) {
  return {
    integration: { findUnique: jest.fn().mockResolvedValue(null) },
    incomeAdjustmentRequest: { findFirst: jest.fn().mockResolvedValue(request) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as DbClient;
}

describe('refund and tariff-change Telegram messages', () => {
  const env = { ...process.env };
  let send: jest.SpyInstance;

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token';
    process.env.PAYMENT_RETURN_GROUP_ID = '-100123';
    process.env.TARIFF_CHANGE_GROUP_ID = '-100456';
    send = jest.spyOn(telegramService, 'sendMessage').mockResolvedValue({} as never);
  });

  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  it('refund request to the refund group', async () => {
    const db = fakeDb({
      id: 'r1',
      reason: 'Kursdan voz kechdi',
      reviewNote: null,
      requestedAmount: 1234567,
      refundCardNumber: '8600 1234',
      createdAt: new Date('2026-03-05T09:00:00+05:00'),
      reviewedAt: null,
      income,
      requestedBy: { id: 'u1', name: 'Sardor', username: 'sardor', telegramId: null },
      reviewedBy: null,
    });

    await sendRefundRequestedTelegram({ tenantId: 't1', requestId: 'r1', requestedByUserId: 'u1', db });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('env-token');
    expect(send.mock.calls[0][1]).toBe('-100123');
    expect(send.mock.calls[0][2]).toBe([
      "#Pul_qaytarish_so'rovi",
      '#Foundation_English',
      '#VIP',
      '#Olim_Karimov',
      '',
      '1.Mijoz: Ali Valiyev',
      '2.Tel: 998901234567',
      '3.Tg: @ali_v',
      '',
      "So'ralgan summa: 1 234 567 so'm",
      'Karta raqami: 8600 1234',
      "Asl to'lov sanasi: 04.03.2026",
      "So'rov yuborgan: Sardor",
      "So'rov vaqti: 05.03.2026",
      'Holat: Kutilmoqda',
      'Izoh: Kursdan voz kechdi',
      '',
      '@Moliya_b0limi',
      '@najotnur_oflayn',
    ].join('\n'));
  });

  it('refund approved: tries the other supergroup form when the first id fails', async () => {
    send.mockRejectedValueOnce(new Error('chat not found'));
    const db = fakeDb({
      id: 'r1', reason: null, reviewNote: null, requestedAmount: null, refundCardNumber: null,
      createdAt: new Date(), reviewedAt: new Date(), income, requestedBy: null, reviewedBy: null,
    });

    await sendRefundApprovedTelegram({ tenantId: 't1', requestId: 'r1', reviewedByUserId: 'u2', db });

    expect(send.mock.calls.map((call) => call[1])).toEqual(['-100123', '-123']);
    expect(send.mock.calls[1][2]).toBe([
      '#Olim_Karimov',
      'Ali Valiyev',
      '998901234567',
      "Summa - 1 500 000 so'm",
      'Karta - -',
      '✅ Qaytarildi',
    ].join('\n'));
  });

  it('refund review result to the requester', async () => {
    const db = fakeDb({
      id: 'r1', reason: null, reviewNote: 'Tasdiqlandi', requestedAmount: 200000, refundCardNumber: null,
      createdAt: new Date('2026-03-05T09:00:00+05:00'), reviewedAt: new Date('2026-03-06T09:00:00+05:00'),
      income, requestedBy: { id: 'u1', name: null, username: 'sardor', telegramId: '777' }, reviewedBy: { id: 'u2', name: 'Moliya', username: null },
    });

    await notifyRefundRequesterReviewResult({ tenantId: 't1', requestId: 'r1', status: 'rejected', db });

    expect(send.mock.calls[0][1]).toBe('777');
    expect(send.mock.calls[0][2]).toBe([
      '❌ Qaytarish rad etildi',
      '',
      '1.Mijoz: Ali Valiyev',
      '2.Tel: 998901234567',
      '3.Tg: @ali_v',
      '',
      "Summa: 200 000 so'm",
      'Karta raqami: -',
      'Kurs/Tarif: Foundation English / VIP',
      "So'rov yuborgan: sardor",
      "Ko'rib chiqqan: Moliya",
      "So'rov vaqti: 05.03.2026",
      "Ko'rib chiqilgan vaqt: 06.03.2026",
      'Javob izohi: Tasdiqlandi',
    ].join('\n'));
  });

  it('tariff change request: sent to each group id exactly as configured', async () => {
    send.mockRejectedValueOnce(new Error('chat not found'));
    const db = fakeDb({
      id: 'r2', reason: null, newAgreementAmount: 3000000, createdAt: new Date('2026-03-05T09:00:00+05:00'),
      requestedBy: { id: 'u1', name: 'Sardor', username: null },
      income, newCourse: { name: 'IELTS', category: 'online' }, newTariff: null,
    });

    await sendTariffChangeRequestedTelegram({ tenantId: 't1', requestId: 'r2', requestedByUserId: 'u1', db });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toBe('-100456');
    expect(send.mock.calls[0][2]).toBe([
      "#Tarif_o'zgarishi_so'rovi\n#IELTS\n#Olim_Karimov",
      '1.Mijoz: Ali Valiyev\n2.Tel: 998901234567\n3.Tg: @ali_v',
      'Eski kurs/tarif: Foundation English / VIP\nYangi kurs/tarif: IELTS',
      "Yangi kelishuv: 3 000 000 so'm",
      "So'rov yuborgan: Sardor\nSo'rov vaqti: 05.03.2026",
    ].join('\n\n'));
  });
});
