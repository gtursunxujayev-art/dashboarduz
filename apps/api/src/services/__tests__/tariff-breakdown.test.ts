import { buildTariffBreakdown } from '../tariff-breakdown';

describe('tariff breakdown', () => {
  const premium = { id: 't-premium', name: 'Premium' };
  const vip = { id: 't-vip', name: 'VIP' };
  const talaba = { id: 't-talaba', name: 'Talaba' };

  it('counts every tariff by its real name, so no sale is dropped', () => {
    const rows = buildTariffBreakdown({
      sales: [
        { tariff: premium, resolvedSubTariffId: null },
        { tariff: premium, resolvedSubTariffId: null },
        { tariff: talaba, resolvedSubTariffId: null },
        { tariff: null, resolvedSubTariffId: null },
      ],
      subTariffNameById: new Map(),
    });
    expect(rows.map((row) => [row.name, row.salesCount])).toEqual([['Premium', 2], ['Talaba', 1], ['Tarifsiz', 1]]);
    expect(rows.reduce((sum, row) => sum + row.salesCount, 0)).toBe(4);
  });

  it('lists the selected course tariffs in order, including those with no sales', () => {
    const rows = buildTariffBreakdown({
      sales: [{ tariff: vip, resolvedSubTariffId: null }],
      subTariffNameById: new Map(),
      knownTariffs: [premium, vip],
    });
    expect(rows.map((row) => [row.name, row.salesCount])).toEqual([['Premium', 0], ['VIP', 1]]);
  });

  it('splits a tariff by sub-tariff only when sub-tariffs are used', () => {
    const rows = buildTariffBreakdown({
      sales: [
        { tariff: premium, resolvedSubTariffId: 's-ertalab' },
        { tariff: premium, resolvedSubTariffId: 's-ertalab' },
        { tariff: premium, resolvedSubTariffId: null },
        { tariff: vip, resolvedSubTariffId: null },
      ],
      subTariffNameById: new Map([['s-ertalab', 'Ertalabki']]),
    });
    expect(rows[0]!.subTariffs).toEqual([
      { subTariffId: 's-ertalab', name: 'Ertalabki', salesCount: 2 },
      { subTariffId: null, name: 'Subtarifsiz', salesCount: 1 },
    ]);
    expect(rows[1]!.subTariffs).toEqual([]);
  });
});
