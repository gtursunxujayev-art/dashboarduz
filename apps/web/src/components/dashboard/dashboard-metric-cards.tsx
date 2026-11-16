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
          className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        >
          <p className="text-sm text-gray-500">{card.title}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900">{card.value}</p>
          <p className="mt-2 text-sm text-gray-600">{card.subtitle}</p>
          {card.extra ? (
            <p className="mt-1 text-sm font-medium text-gray-700">{card.extra}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export type { DashboardCard };
