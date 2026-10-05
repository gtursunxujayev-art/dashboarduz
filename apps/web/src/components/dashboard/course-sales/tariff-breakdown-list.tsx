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
    <div className="mt-2 space-y-1 text-sm text-gray-700">
      {rows.map((row) => (
        <div key={row.tariffId ?? 'none'}>
          <p><span className="font-medium">{row.name}</span> - {row.salesCount}</p>
          {row.subTariffs.length > 0 && (
            <div className="ml-3 space-y-0.5 text-xs text-gray-500">
              {row.subTariffs.map((sub) => (
                <p key={sub.subTariffId ?? 'none'}>{sub.name} - {sub.salesCount}</p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
