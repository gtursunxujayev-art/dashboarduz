'use client';

type DashboardCard = {
  id: string;
  title: string;
  value: string;
  subtitle: string;
  extra: string | null;
};

type Props = {
  cards: DashboardCard[];
  columns: 3 | 5;
};

export default function DashboardMetricCards({ cards, columns }: Props) {
  const gridClass = columns === 5
    ? 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5'
    : 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3';

  return (
    <div className={gridClass}>
      {cards.map((card) => (
        <div
          key={card.id}
          className="panel p-5"
        >
          <p className="text-[13px] font-medium text-gray-500">{card.title}</p>
          <p className="tabular mt-3 text-[26px] font-semibold leading-none tracking-tight text-gray-900">{card.value}</p>
          <p className="mt-3 text-[13px] leading-snug text-gray-500">{card.subtitle}</p>
          {card.extra ? (
            <p className="mt-1 text-[13px] font-medium leading-snug text-gray-700">{card.extra}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export type { DashboardCard };
