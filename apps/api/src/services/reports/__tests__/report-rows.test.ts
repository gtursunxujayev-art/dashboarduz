import {
  computeResponseMinutes,
  resolvePersonLabel,
  resolveRootSaleId,
  selectDebtorSales,
} from '../report-rows';

describe('report rows', () => {
  it('keeps only sales with debt, excludes technical sales, and sorts by debt', () => {
    const at = new Date('2026-09-01T05:00:00.000Z');
    const metrics = new Map([
      ['paid-off', { agreementAmount: 1_000_000, paidAmount: 1_000_000, currentDebtAmount: 0, lastActivityAt: at }],
      ['small-debt', { agreementAmount: 1_000_000, paidAmount: 800_000, currentDebtAmount: 200_000, lastActivityAt: at }],
      ['big-debt', { agreementAmount: 3_000_000, paidAmount: 1_000_000, currentDebtAmount: 2_000_000, lastActivityAt: at }],
      ['technical', { agreementAmount: 1, paidAmount: 0, currentDebtAmount: 1, lastActivityAt: at }],
    ]);

    const rows = selectDebtorSales({
      sales: [
        { id: 'paid-off' },
        { id: 'small-debt' },
        { id: 'big-debt' },
        { id: 'technical' },
        { id: 'no-metric', remainingDebtAmount: 50_000 },
      ],
      chainMetricsBySaleId: metrics,
      technicalSaleIds: new Set(['technical']),
    });

    expect(rows.map((row) => [row.sale.id, row.debtAmount])).toEqual([
      ['big-debt', 2_000_000],
      ['small-debt', 200_000],
      ['no-metric', 50_000],
    ]);
  });

  it('resolves the root sale for refunds that point at a repayment', () => {
    expect(resolveRootSaleId({ id: 'sale-1', type: 'new_sale', relatedDebtIncomeId: null })).toBe('sale-1');
    expect(resolveRootSaleId({ id: 'rep-1', type: 'repayment', relatedDebtIncomeId: 'sale-1' })).toBe('sale-1');
  });

  it('computes response time in minutes and null while pending', () => {
    const createdAt = new Date('2026-09-26T10:00:00.000Z');
    expect(computeResponseMinutes(createdAt, new Date('2026-09-26T12:15:29.000Z'))).toBe(135);
    expect(computeResponseMinutes(createdAt, null)).toBeNull();
  });

  it('labels people by name, then username, then fallback', () => {
    expect(resolvePersonLabel({ name: 'Sabina', username: 'sabina' })).toBe('Sabina');
    expect(resolvePersonLabel({ name: null, username: 'komila' })).toBe('komila');
    expect(resolvePersonLabel(null)).toBe('-');
  });
});
