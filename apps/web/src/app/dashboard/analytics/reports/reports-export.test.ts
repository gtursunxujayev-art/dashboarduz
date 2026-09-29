import { describe, expect, it } from '@jest/globals';
import {
  DEBTOR_EXPORT_HEADERS,
  REFUND_EXPORT_HEADERS,
  TARIFF_CHANGE_EXPORT_HEADERS,
  buildDebtorExportRows,
  buildRefundExportRows,
  buildTariffChangeExportRows,
  formatResponseDuration,
  getReportFilename,
  type AdjustmentReportRow,
} from './reports-export';

const baseRequest: AdjustmentReportRow = {
  status: 'approved',
  requestDate: '2026-09-26T05:11:43.000Z',
  reviewedAt: '2026-09-26T07:26:43.000Z',
  responseMinutes: 135,
  reviewedByLabel: 'Admin',
  customerNumber: '977643366',
  customerName: 'Bekzod Amanov',
  managerLabel: 'Sabina',
  firstPaymentDate: '2026-09-01T05:00:00.000Z',
  fromCourseName: 'Online-Iyul',
  fromTariffName: 'Standart',
  toCourseName: 'Online-Sentyabr',
  toTariffName: 'Premium',
  agreementAmount: 3_000_000,
  newAgreementAmount: 4_000_000,
  paidAmount: 1_000_000,
  debtAmount: 3_000_000,
  requestedAmount: 1_000_000,
  reason: '=HYPERLINK("x")',
  reviewNote: null,
};

describe('reports export', () => {
  it('formats response durations in Uzbek', () => {
    expect(formatResponseDuration(null)).toBe('');
    expect(formatResponseDuration(0)).toBe('0 daqiqa');
    expect(formatResponseDuration(135)).toBe('2 soat 15 daqiqa');
    expect(formatResponseDuration(120)).toBe('2 soat');
    expect(formatResponseDuration(1_620)).toBe('1 kun 3 soat');
  });

  it('builds debtor rows matching the header order', () => {
    const [row] = buildDebtorExportRows([{
      customerNumber: '906627270',
      customerName: 'Behruz',
      managerLabel: 'Komila',
      courseName: 'Offline-Sentyabr',
      tariffName: 'VIP',
      firstPaymentDate: '2026-08-31T20:30:00.000Z',
      lastPaymentDate: '2026-09-20T05:00:00.000Z',
      agreementAmount: 5_000_000,
      paidAmount: 2_000_000,
      debtAmount: 3_000_000,
    }]);
    expect(row).toHaveLength(DEBTOR_EXPORT_HEADERS.length);
    expect(row).toEqual([
      '906627270', 'Behruz', 'Komila', 'Offline-Sentyabr / VIP', '2026-09-01', 5_000_000, 2_000_000, 3_000_000, '2026-09-20',
    ]);
  });

  it('builds tariff change rows with from/to courses and response time', () => {
    const [row] = buildTariffChangeExportRows([baseRequest]);
    expect(row).toHaveLength(TARIFF_CHANGE_EXPORT_HEADERS.length);
    expect(row.slice(0, 7)).toEqual([
      '2026-09-26 10:11', '977643366', 'Bekzod Amanov', 'Sabina', '2026-09-01', 'Online-Iyul / Standart', 'Online-Sentyabr / Premium',
    ]);
    expect(row.slice(11, 14)).toEqual(['Tasdiqlangan', '2 soat 15 daqiqa', 135]);
    expect(row[15]).toBe('\'=HYPERLINK("x")');
  });

  it('marks pending refunds as waiting', () => {
    const [row] = buildRefundExportRows([{ ...baseRequest, status: 'pending', reviewedAt: null, responseMinutes: null }]);
    expect(row).toHaveLength(REFUND_EXPORT_HEADERS.length);
    expect(row.slice(9, 13)).toEqual([1_000_000, 'Kutilmoqda', 'Kutilmoqda', null]);
  });

  it('builds filenames with the date range', () => {
    expect(getReportFilename('debtors')).toBe('qarzdorlar.xlsx');
    expect(getReportFilename('refund', '2026-09-01', '2026-09-29')).toBe('pul-qaytarish-sorovlari_2026-09-01_2026-09-29.xlsx');
  });
});
