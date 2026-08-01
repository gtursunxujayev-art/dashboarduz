import { describe, expect, it } from '@jest/globals';
import {
  BONUS_DETAIL_EXPORT_HEADERS,
  buildBonusDetailExportRows,
  formatBonusExportDate,
  sanitizeSpreadsheetText,
} from './bonus-detail-export';

describe('bonus detail XLS export', () => {
  it('keeps the visible 13-column order and numeric values', () => {
    const [row] = buildBonusDetailExportRows([{
      entryDate: '2026-07-31T20:30:00.000Z',
      type: 'new_sale',
      customerNumber: 'C-17',
      customerName: 'Ali Valiyev',
      managerLabel: 'Agent A',
      courseName: 'Online',
      tariffName: 'Premium',
      subTariffName: 'Morning',
      agreementAmount: 12_000_000,
      paymentAmount: 4_000_000,
      remainingDebtAmount: 8_000_000,
      calculatedBonus: 360_000,
      isLastPayment: true,
      bonusDebug: {
        category: 'online',
        closedCount: 12,
        appliedPercent: 3,
        usedFallback: false,
      },
    }]);

    expect(BONUS_DETAIL_EXPORT_HEADERS).toHaveLength(13);
    expect(row).toHaveLength(13);
    expect(row).toEqual([
      '2026-08-01',
      'Yangi sotuv',
      'C-17 - Ali Valiyev',
      'Agent A',
      'Online / Premium / Morning',
      12_000_000,
      4_000_000,
      8_000_000,
      360_000,
      'online',
      12,
      3,
      "yo'q",
    ]);
  });

  it('leaves the bonus cell blank for a non-qualifying payment row', () => {
    const [row] = buildBonusDetailExportRows([{
      entryDate: '2026-08-01T00:00:00+05:00',
      type: 'repayment',
      calculatedBonus: 0,
      isLastPayment: false,
    }]);

    expect(row?.[1]).toBe("Qarzdorlik to'lovi");
    expect(row?.[8]).toBeNull();
  });

  it('sanitizes formula-like text and formats dates in Asia/Tashkent', () => {
    expect(sanitizeSpreadsheetText('=HYPERLINK("bad")')).toBe("'=HYPERLINK(\"bad\")");
    expect(sanitizeSpreadsheetText('  +cmd')).toBe("'  +cmd");
    expect(sanitizeSpreadsheetText('Normal')).toBe('Normal');
    expect(formatBonusExportDate('2026-07-31T20:30:00.000Z')).toBe('2026-08-01');
  });
});
