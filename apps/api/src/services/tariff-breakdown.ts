export type TariffBreakdownRow = {
  tariffId: string | null;
  name: string;
  salesCount: number;
  subTariffs: Array<{ subTariffId: string | null; name: string; salesCount: number }>;
};

const NO_TARIFF_LABEL = 'Tarifsiz';
const NO_SUB_TARIFF_LABEL = 'Subtarifsiz';
const NO_TARIFF_KEY = '__none__';

/** Grouping key for a tariff or sub-tariff name: case and repeated spaces do not make a different tariff. */
function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('uz');
}

/**
 * Sales per tariff, using the tariffs' real names (never a hard-coded VIP/Premium/Standart list, which silently
 * dropped every tariff with another name). Each tariff lists its sub-tariffs when any of its sales has one.
 * `knownTariffs` (e.g. all tariffs of the selected course) are listed even with zero sales, in their given order.
 *
 * Rows are grouped by tariff NAME, not id: every course has its own "VIP" tariff, so on pages that span several
 * courses all "VIP" sales are counted together. Sub-tariffs are grouped by name the same way.
 * A merged row keeps the id of the first tariff seen with that name.
 */
export function buildTariffBreakdown(params: {
  sales: Array<{ tariff: { id: string; name: string } | null; resolvedSubTariffId: string | null }>;
  subTariffNameById: Map<string, string>;
  knownTariffs?: Array<{ id: string; name: string }>;
}): TariffBreakdownRow[] {
  const rows = new Map<string, TariffBreakdownRow & { subTariffMap: Map<string, { subTariffId: string | null; name: string; salesCount: number }> }>();
  const order: string[] = [];
  const ensure = (tariffId: string | null, rawName: string | null | undefined) => {
    const name = rawName?.trim().replace(/\s+/g, ' ') || '';
    const key = tariffId && name ? nameKey(name) : NO_TARIFF_KEY;
    let row = rows.get(key);

    if (!row) {
      row = {
        tariffId: key === NO_TARIFF_KEY ? null : tariffId,
        name: key === NO_TARIFF_KEY ? NO_TARIFF_LABEL : name,
        salesCount: 0,
        subTariffs: [],
        subTariffMap: new Map(),
      };
      rows.set(key, row);
      order.push(key);
    }

    return row;
  };

  for (const tariff of params.knownTariffs ?? []) {
    ensure(tariff.id, tariff.name);
  }
  for (const sale of params.sales) {
    const row = ensure(sale.tariff?.id ?? null, sale.tariff?.name);

    row.salesCount += 1;
    const subName = sale.resolvedSubTariffId
      ? params.subTariffNameById.get(sale.resolvedSubTariffId)?.trim().replace(/\s+/g, ' ') || NO_SUB_TARIFF_LABEL
      : NO_SUB_TARIFF_LABEL;
    const subKey = sale.resolvedSubTariffId ? nameKey(subName) : NO_TARIFF_KEY;
    const sub = row.subTariffMap.get(subKey) || {
      subTariffId: sale.resolvedSubTariffId,
      name: subName,
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
