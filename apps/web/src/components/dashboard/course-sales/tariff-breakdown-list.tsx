'use client';

type TariffBreakdownRow = {
  tariffId: string | null;
  name: string;
  salesCount: number;
  subTariffs: Array<{ subTariffId: string | null; name: string; salesCount: number }>;
};

/** Sales per tariff (and sub-tariff, when used), by the tariffs' real names. */
export default function TariffBreakdownList({ rows }: { rows: TariffBreakdownRow[] | undefined }) {
  if (!rows?.length) {
    return <p className="mt-2 text-sm text-gray-500">Sotuv yo&apos;q</p>;
  }
  return (
    <div className="mt-2 divide-y divide-gray-100 text-sm text-gray-700">
      {rows.map((row) => (
        <div key={row.tariffId ?? 'none'} className="py-2 first:pt-0 last:pb-0">
          <p className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate font-medium text-gray-900">{row.name}</span>
            <span className="badge badge-blue tabular">{row.salesCount}</span>
          </p>
          {row.subTariffs.length > 0 && (
            <div className="ml-1 mt-1.5 space-y-1 border-l-2 border-gray-100 pl-3 text-xs text-gray-500">
              {row.subTariffs.map((sub) => (
                <p key={sub.subTariffId ?? 'none'} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{sub.name}</span>
                  <span className="tabular font-medium text-gray-700">{sub.salesCount}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
