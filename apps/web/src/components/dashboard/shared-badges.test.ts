import { describe, expect, it } from '@jest/globals';
import { getIncomeStatusBadge } from '@/components/dashboard/income-status-badge';
import {
  getConversionBadge,
  getDailyTalkBadge,
  getDeadlineBadge,
  getDebtCollectionBadge,
  getFollowUpBadge,
  getMissedCallBadge,
  getOutboundBadge,
  getRefundBadge,
  getResponseTimeBadge,
} from '@/components/dashboard/seller-kpi-badges';

describe('seller KPI badges', () => {
  it('grade higher-is-better rates', () => {
    expect([null, 15, 10, 9.9].map(getConversionBadge)).toEqual(['neutral', 'good', 'warning', 'critical']);
    expect([undefined, 85, 70, 69].map(getDebtCollectionBadge)).toEqual(['neutral', 'good', 'warning', 'critical']);
    expect([null, 90, 75, 74].map(getDeadlineBadge)).toEqual(['neutral', 'good', 'warning', 'critical']);
  });

  it('grade lower-is-better rates', () => {
    expect([null, 5, 10, 10.1].map(getMissedCallBadge)).toEqual(['neutral', 'good', 'warning', 'critical']);
    expect([null, 5, 8, 8.1].map(getRefundBadge)).toEqual(['neutral', 'good', 'warning', 'critical']);
    expect([0, 300, 1800, 1801].map(getResponseTimeBadge)).toEqual(['neutral', 'good', 'warning', 'critical']);
  });

  it('grade shares and talk time', () => {
    expect(getFollowUpBadge(0, 0)).toBe('neutral');
    expect(getFollowUpBadge(9, 1)).toBe('good');
    expect(getFollowUpBadge(8, 2)).toBe('warning');
    expect(getFollowUpBadge(7, 3)).toBe('critical');
    expect(getOutboundBadge(0, 0)).toBe('neutral');
    expect(getOutboundBadge(6, 10)).toBe('good');
    expect(getOutboundBadge(5, 10)).toBe('warning');
    expect(getOutboundBadge(4, 10)).toBe('critical');
    expect(getDailyTalkBadge(9000, false)).toBe('neutral');
    expect(getDailyTalkBadge(7200, true)).toBe('good');
    expect(getDailyTalkBadge(5400, true)).toBe('warning');
    expect(getDailyTalkBadge(null, true)).toBe('critical');
  });
});

describe('getIncomeStatusBadge', () => {
  it('labels lifecycle statuses, with dark-mode classes only when asked (adjustments vs finance)', () => {
    expect(getIncomeStatusBadge('refunded', { darkMode: false })).toEqual({ label: 'Qizil: Qaytarilgan', className: 'bg-red-100 text-red-800' });
    expect(getIncomeStatusBadge('pending_refund', { darkMode: true }).className).toBe('bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200');
    expect(getIncomeStatusBadge('active', { darkMode: true })).toEqual({
      label: 'Aktiv',
      className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    });
  });
});
