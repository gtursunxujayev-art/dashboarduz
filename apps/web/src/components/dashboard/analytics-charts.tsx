'use client';

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

type DashboardRange = 'today' | 'week' | 'month' | 'custom';

type PieDatum = {
  name: string;
  value: number;
  color: string;
};

type DashboardSummaryResponse = {
  range: DashboardRange;
  summary: {
    totalLeads: number;
    totalCalls: number;
    pendingNotifications: number;
    activeIntegrations: number;
  };
  pieCharts: {
    nonQualifiedByReason: {
      fieldKey: string | null;
      fieldLabel: string | null;
      data: PieDatum[];
    };
    newLeadsBySource: {
      fieldKey: string | null;
      fieldLabel: string | null;
      data: PieDatum[];
    };
  };
  updatedAt: string;
};

interface AnalyticsChartsProps {
  data?: DashboardSummaryResponse;
  isLoading?: boolean;
  isError?: boolean;
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 text-center text-sm text-gray-500">
      {text}
    </div>
  );
}

function PieCard({
  title,
  subtitle,
  points,
  emptyText,
}: {
  title: string;
  subtitle: string;
  points: PieDatum[];
  emptyText: string;
}) {
  const hasData = points.length > 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h4 className="text-base font-semibold text-gray-900">{title}</h4>
      <p className="mt-1 text-sm text-gray-500">{subtitle}</p>

      <div className="mt-4">
        {hasData ? (
          <>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={points}
                    cx="50%"
                    cy="50%"
                    dataKey="value"
                    nameKey="name"
                    outerRadius={100}
                    label={({ percent }: { percent?: number }) => `${((percent ?? 0) * 100).toFixed(0)}%`}
                    labelLine
                  >
                    {points.map((point, index) => (
                      <Cell key={`cell-${index}`} fill={point.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [value, 'Soni']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {points.map((point) => (
                <div key={point.name} className="flex items-start gap-2 text-sm text-gray-700">
                  <span
                    className="mt-1 inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: point.color }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="truncate">{point.name}</p>
                    <p className="font-semibold">{point.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <EmptyPanel text={emptyText} />
        )}
      </div>
    </div>
  );
}

export default function AnalyticsCharts({
  data,
  isLoading = false,
  isError = false,
}: AnalyticsChartsProps) {
  const reasonChart = data?.pieCharts.nonQualifiedByReason;
  const sourceChart = data?.pieCharts.newLeadsBySource;

  return (
    <div className="space-y-6">
      {isError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Boshqaruv tahlillarini yuklashda xatolik yuz berdi.
        </div>
      )}

      {isLoading && (
        <div className="rounded-md border border-gray-200 bg-white px-3 py-3 text-sm text-gray-600">
          Tahlillar yuklanmoqda...
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <PieCard
          title="Sifatsiz lidlar sababi bo'yicha"
          subtitle={
            reasonChart?.fieldLabel
              ? `Tanlangan davrda "${reasonChart.fieldLabel}" maydoni bo'yicha guruhlandi.`
              : "Diagramma uchun Sozlamalarda sabab maydonini tanlang."
          }
          points={reasonChart?.data ?? []}
          emptyText={
            reasonChart?.fieldKey
              ? 'Tanlangan davrda sifatsiz lid sabablari topilmadi.'
              : "Avval Sozlamalarda sabab maydonini sozlang."
          }
        />

        <PieCard
          title="Yangi lidlar manba bo'yicha"
          subtitle={
            sourceChart?.fieldLabel
              ? `Tanlangan davrda "${sourceChart.fieldLabel}" maydoni bo'yicha guruhlandi.`
              : "Diagramma uchun Sozlamalarda manba maydonini tanlang."
          }
          points={sourceChart?.data ?? []}
          emptyText={
            sourceChart?.fieldKey
              ? "Tanlangan davr uchun manba ma'lumoti topilmadi."
              : "Avval Sozlamalarda manba maydonini sozlang."
          }
        />
      </div>

      <p className="text-center text-xs text-gray-500">
        Ma'lumot yangilangan vaqt: {data?.updatedAt ? new Date(data.updatedAt).toLocaleString('uz-UZ') : "Mavjud emas"}
      </p>
    </div>
  );
}
