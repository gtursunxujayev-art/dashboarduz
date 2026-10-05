export type TariffBreakdownRow = {
  tariffId: string | null;
  name: string;
  salesCount: number;
  subTariffs: Array<{ subTariffId: string | null; name: string; salesCount: number }>;
};

const NO_TARIFF_LABEL = 'Tarifsiz';
const NO_SUB_TARIFF_LABEL = 'Subtarifsiz';

/**
 * Sales per tariff, using the tariffs' real names (never a hard-coded VIP/Premium/Standart list, which silently
 * dropped every tariff with another name). Each tariff lists its sub-tariffs when any of its sales has one.
 * `knownTariffs` (e.g. all tariffs of the selected course) are listed even with zero sales, in their given order.
 */
export function buildTariffBreakdown(params: {
  sales: Array<{ tariff: { id: string; name: string } | null; resolvedSubTariffId: string | null }>;
  subTariffNameById: Map<string, string>;
  knownTariffs?: Array<{ id: string; name: string }>;
}): TariffBreakdownRow[] {
  const rows = new Map<string, TariffBreakdownRow & { subTariffMap: Map<string, { subTariffId: string | null; name: string; salesCount: number }> }>();
  const order: string[] = [];
  const ensure = (tariffId: string | null, name: string) => {
    const key = tariffId ?? '__none__';
    let row = rows.get(key);
    if (!row) {
      row = { tariffId, name, salesCount: 0, subTariffs: [], subTariffMap: new Map() };
      rows.set(key, row);
      order.push(key);
    }
    return row;
  };

  for (const tariff of params.knownTariffs ?? []) {
    ensure(tariff.id, tariff.name);
  }
  for (const sale of params.sales) {
    const row = ensure(sale.tariff?.id ?? null, sale.tariff?.name?.trim() || NO_TARIFF_LABEL);
    row.salesCount += 1;
    const subKey = sale.resolvedSubTariffId ?? '__none__';
    const sub = row.subTariffMap.get(subKey) || {
      subTariffId: sale.resolvedSubTariffId,
      name: sale.resolvedSubTariffId
        ? params.subTariffNameById.get(sale.resolvedSubTariffId) || NO_SUB_TARIFF_LABEL
        : NO_SUB_TARIFF_LABEL,
      salesCount: 0,
    };
    sub.salesCount += 1;
    row.subTariffMap.set(subKey, sub);
  }

  return order.map((key) => {
    const { subTariffMap, ...row } = rows.get(key)!;
    const subTariffs = [...subTariffMap.values()].sort((left, right) => right.salesCount - left.salesCount);
    // Only show the sub-tariff split when at least one sale actually has a sub-tariff.
    return { ...row, subTariffs: subTariffs.some((sub) => sub.subTariffId) ? subTariffs : [] };
  });
}
