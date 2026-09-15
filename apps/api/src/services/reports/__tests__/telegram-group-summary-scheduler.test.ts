import {
  aggregateTelegramGroupSummaries,
  formatTelegramGroupSummary,
  getTashkentDayWindow,
  resolveDueTelegramGroupSummaryCutoffs,
  type SummaryIncomeRow,
} from '../telegram-group-summary-scheduler';
import { getOfflineTelegramGroupIds, getOnlineTelegramGroupIds } from '../../integrations/telegram-groups';

function row(overrides: Partial<SummaryIncomeRow> = {}): SummaryIncomeRow {
  return {
    id: 'sale-1',
    type: 'new_sale',
    relatedDebtIncomeId: null,
    paymentAmount: 1_000_000,
    coursePriceAmount: 3_000_000,
    debtAmount: 3_000_000,
    courseId: 'course-online',
    course: { id: 'course-online', name: 'Online kurs', category: 'online' },
    ...overrides,
  };
}

describe('Telegram group summaries', () => {
  afterEach(() => {
    delete process.env.ONLINE_GROUP_ID;
    delete process.env.ONLINE_GROUP_IDS;
    delete process.env.OFLINE_GROUP_ID;
    delete process.env.OFFLINE_GROUP_IDS;
  });

  it('accepts singular and comma-separated Railway group variables without duplicates', () => {
    process.env.ONLINE_GROUP_ID = '-1001';
    process.env.ONLINE_GROUP_IDS = '-1001, -1002';
    process.env.OFLINE_GROUP_ID = '-2001';
    process.env.OFFLINE_GROUP_IDS = '-2002,-2001';
    expect(getOnlineTelegramGroupIds()).toEqual(['-1001', '-1002']);
    expect(getOfflineTelegramGroupIds()).toEqual(['-2001', '-2002']);
  });

  it('isolates Online from Offline and attributes repayment through its original sale', () => {
    const onlineSale = row();
    const offlineSale = row({
      id: 'sale-2', courseId: 'course-offline',
      course: { id: 'course-offline', name: 'Couching', category: 'offline' },
      paymentAmount: 500_000,
    });
    const repayment = row({
      id: 'repayment-1', type: 'repayment', relatedDebtIncomeId: 'sale-2',
      courseId: null, course: null, paymentAmount: 250_000, coursePriceAmount: null, debtAmount: 2_500_000,
    });
    const metrics = aggregateTelegramGroupSummaries({
      rows: [onlineSale, offlineSale, repayment],
      ancestors: [onlineSale, offlineSale],
      selectedCourseIds: new Set(['course-offline']),
    });

    expect(metrics.online).toMatchObject({ newSalesCount: 1, totalIncome: 1_000_000, newIncome: 1_000_000, debtIncome: 0 });
    expect(metrics.offline).toMatchObject({
      newSalesCount: 1, totalIncome: 750_000, newIncome: 500_000, debtIncome: 250_000,
      coaching: { salesCount: 1, income: 750_000 },
    });
  });

  it('includes selected intensive totals but omits unselected extra lines', () => {
    const intensive = row({
      id: 'intensive-sale', courseId: 'intensive-course', paymentAmount: 2_000_000,
      course: { id: 'intensive-course', name: 'Intensiv', category: 'intensive' },
    });
    const selected = aggregateTelegramGroupSummaries({
      rows: [intensive], ancestors: [], selectedCourseIds: new Set(['intensive-course']),
    });
    expect(selected.offline.intensive).toEqual({ salesCount: 1, income: 2_000_000 });
    expect(selected.offline.coaching).toBeUndefined();

    const unselected = aggregateTelegramGroupSummaries({ rows: [intensive], ancestors: [], selectedCourseIds: new Set() });
    expect(unselected.offline.intensive).toBeUndefined();
  });

  it('keeps a selected course line visible when its daily values are zero', () => {
    const metrics = aggregateTelegramGroupSummaries({
      rows: [],
      ancestors: [],
      selectedCourseIds: new Set(['offline-course', 'intensive-course']),
      selectedCourseCategories: new Map([
        ['offline-course', 'offline'],
        ['intensive-course', 'intensive'],
      ]),
    });
    expect(metrics.offline.coaching).toEqual({ salesCount: 0, income: 0 });
    expect(metrics.offline.intensive).toEqual({ salesCount: 0, income: 0 });
  });

  it('excludes technical sale chains', () => {
    const technical = row({ coursePriceAmount: 1, debtAmount: 1, paymentAmount: 1 });
    const repayment = row({
      id: 'technical-repayment', type: 'repayment', relatedDebtIncomeId: technical.id,
      courseId: null, course: null, coursePriceAmount: null, paymentAmount: 100,
    });
    const metrics = aggregateTelegramGroupSummaries({ rows: [technical, repayment], ancestors: [technical], selectedCourseIds: new Set() });
    expect(metrics.online).toEqual({ newSalesCount: 0, totalIncome: 0, newIncome: 0, debtIncome: 0 });
  });

  it('formats the requested emoji message and Uzbek currency spacing', () => {
    expect(formatTelegramGroupSummary('offline', {
      newSalesCount: 2,
      totalIncome: 1_250_000,
      newIncome: 1_000_000,
      debtIncome: 250_000,
      coaching: { salesCount: 1, income: 700_000 },
      intensive: { salesCount: 1, income: 550_000 },
    })).toBe([
      '📊 Bugun — Offline',
      '🆕 Yangi sotuvlar: 2',
      "💰 Umumiy tushum: 1 250 000 so'm",
      "💳 Yangi tushum: 1 000 000 so'm",
      "📥 Qarzdorlik tushumi: 250 000 so'm",
      '🎓 Couching sotuvi: 1',
      "💰 Couching tushumi: 700 000 so'm",
      '🔥 Intensiv sotuvi: 1',
      "💰 Intensiv tushumi: 550 000 so'm",
    ].join('\n'));
  });

  it('uses Tashkent day boundaries and exposes same-day cutoff catch-up', () => {
    const before = new Date('2026-09-15T12:59:59.000Z'); // 17:59:59 Tashkent
    const after18 = new Date('2026-09-15T13:10:00.000Z');
    const after2359 = new Date('2026-09-15T18:59:20.000Z');
    expect(resolveDueTelegramGroupSummaryCutoffs(before)).toEqual([]);
    expect(resolveDueTelegramGroupSummaryCutoffs(after18)).toEqual(['18:00']);
    expect(resolveDueTelegramGroupSummaryCutoffs(after2359)).toEqual(['18:00', '23:59']);
    expect(getTashkentDayWindow(after18)).toMatchObject({
      dateKey: '2026-09-15', start: new Date('2026-09-14T19:00:00.000Z'), end: after18,
    });
  });
});
