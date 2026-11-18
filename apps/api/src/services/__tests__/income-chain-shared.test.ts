import { normalizeSubTariffName } from '@dashboarduz/shared';

import { buildActiveSaleChainMetrics, extractSaleSubTariffId, INCOME_LIFECYCLE_ACTIVE, saleChainOrder } from '../income-chain';

describe('extractSaleSubTariffId', () => {
  it('reads a trimmed saleSubTariffId string from meta', () => {
    expect(extractSaleSubTariffId({ saleSubTariffId: ' st1 ' })).toBe('st1');
    expect(extractSaleSubTariffId({ saleSubTariffId: '  ' })).toBeNull();
    expect(extractSaleSubTariffId({ saleSubTariffId: 5 })).toBeNull();
    expect(extractSaleSubTariffId([{ saleSubTariffId: 'x' }])).toBeNull();
    expect(extractSaleSubTariffId(null)).toBeNull();
  });
});

describe('normalizeSubTariffName', () => {
  it('trims and lower-cases', () => {
    expect(normalizeSubTariffName('  VIP Plus ')).toBe('vip plus');
    expect(normalizeSubTariffName(null)).toBe('');
  });
});

describe('buildActiveSaleChainMetrics', () => {
  it('skips the query for no sales', async () => {
    const findMany = jest.fn();
    const result = await buildActiveSaleChainMetrics({ tenantId: 't', sales: [], db: { income: { findMany } } as never });

    expect(result.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('loads active chain rows for the tenant and builds metrics per sale', async () => {
    const entryDate = new Date('2024-01-01T00:00:00Z');
    const findMany = jest.fn().mockResolvedValue([
      { id: 's1', relatedDebtIncomeId: null, paymentAmount: 300, entryDate },
      { id: 'p1', relatedDebtIncomeId: 's1', paymentAmount: 200, entryDate: new Date('2024-02-01T00:00:00Z') },
    ]);
    const result = await buildActiveSaleChainMetrics({
      tenantId: 't',
      sales: [{ id: 's1', entryDate, coursePriceAmount: 1000, paymentAmount: 300 }],
      db: { income: { findMany } } as never,
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 't', lifecycleStatus: INCOME_LIFECYCLE_ACTIVE }),
    }));
    expect(result.get('s1')).toEqual(expect.objectContaining({ agreementAmount: 1000, paidAmount: 500, currentDebtAmount: 500 }));
  });
});

describe('saleChainOrder', () => {
  const day = new Date('2026-10-01T07:00:00Z');
  const row = (id: string, entryDate: Date, createdAt: Date) => ({ id, entryDate, createdAt });

  it('keeps the sale first on its entry date even when a repayment of that date was created earlier', () => {
    const rows = [row('r1', day, new Date(day.getTime() - 60_000)), row('sale', day, day), row('r0', new Date(day.getTime() - 86_400_000), day)];

    expect(rows.sort(saleChainOrder('sale')).map((item) => item.id)).toEqual(['r0', 'sale', 'r1']);
  });

  it('orders equal dates and equal creation times by id, the same way every time', () => {
    const rows = [row('c', day, day), row('a', day, day), row('b', day, day)];

    expect([...rows].sort(saleChainOrder('sale')).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect([...rows].reverse().sort(saleChainOrder('sale')).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});
