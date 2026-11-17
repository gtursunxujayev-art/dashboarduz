'use client';

type TariffBreakdownRow = {
  tariffId: string | null;
  name: string;
  salesCount: number;
  subTariffs: Array<{ subTariffId: string | null; name: string; salesCount: number }>;
};

function shareWidth(part: number, total: number) {
  if (!total || total <= 0) return '0%';
  return `${Math.max(2, Math.round((Math.max(0, part) / total) * 100))}%`;
}

/**
 * Sales per tariff (and sub-tariff, when used), by the tariffs' real names. Each row carries a
 * share bar against the total. `variant="cards"` lays the tariffs out as a responsive card grid
 * for wide panels; the default is a ranked list for side columns.
 */
export default function TariffBreakdownList({
  rows,
  variant = 'list',
  dense = false,
}: {
  rows: TariffBreakdownRow[] | undefined;
  variant?: 'list' | 'cards';
  /** Tighter row spacing for the list variant, for panels with a fixed height. */
  dense?: boolean;
}) {
  if (!rows?.length) {
    return <p className="mt-2 rounded-[12px] border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">Sotuv yo&apos;q</p>;
  }
  const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.salesCount) || 0), 0);

  if (variant === 'cards') {
    return (
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <div key={row.tariffId ?? 'none'} className="panel-inset flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-semibold text-gray-900">{row.name}</span>
              <span className="tabular text-xl font-semibold leading-none tracking-tight text-gray-900">{row.salesCount}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
              <span className="block h-full origin-left animate-grow-x rounded-full bg-blue-600" style={{ width: shareWidth(row.salesCount, total) }} />
            </div>
            {row.subTariffs.length > 0 && (
              <div className="space-y-1 border-t border-gray-200 pt-2.5 text-xs text-gray-500">
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

  return (
    <div className={`mt-2 ${dense ? 'space-y-2.5' : 'space-y-3.5'} text-sm text-gray-700`}>
      {rows.map((row) => (
        <div key={row.tariffId ?? 'none'}>
          <p className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate font-medium text-gray-900">{row.name}</span>
            <span className="badge badge-blue tabular">{row.salesCount}</span>
          </p>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
            <span className="block h-full origin-left animate-grow-x rounded-full bg-blue-600" style={{ width: shareWidth(row.salesCount, total) }} />
          </div>
          {row.subTariffs.length > 0 && (
            <div className="ml-1 mt-2 space-y-1 border-l-2 border-gray-100 pl-3 text-xs text-gray-500">
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
