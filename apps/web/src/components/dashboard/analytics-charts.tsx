'use client';

type DashboardRange = 'today' | 'week' | 'month' | 'custom';

type SellerPerformanceRow = {
  userId: string;
  name: string;
  newLeads: number | null;
  qualifiedLeads: number | null;
  sales: number;
  conversionPercent: number | null;
  agreementsAmount: number;
  incomeAmount: number;
  talkedSeconds: number | null;
  callsCount: number;
  followUpCount: number;
  noteCount: number;
  stageChangeCount: number;
  overdueFollowUpCount: number;
  todayFollowUpCount: number;
};

type DashboardSummaryResponse = {
  range: DashboardRange;
  sourceStatus?: {
    amoContext?: { ok: boolean; retried: boolean; reason: string | null };
    catalog?: { ok: boolean; retried: boolean; reason: string | null };
    leads?: { ok: boolean; retried: boolean; reason: string | null };
    activity?: { ok: boolean; retried: boolean; reason: string | null };
    corporateCalls?: { ok: boolean; retried: boolean; reason: string | null };
  };
  summary: {
    totalLeads: number;
    qualifiedLeads: number;
    nonQualifiedLeads: number;
    totalCalls: number;
    totalIncomeAmount: number;
    newSalesCount: number;
    newSalesAgreementAmount: number;
    onlineSalesCount: number;
    onlineSalesAgreementAmount: number;
    onlineSalesIncomeAmount: number;
    offlineSalesCount: number;
    offlineSalesAgreementAmount: number;
    offlineSalesIncomeAmount: number;
    intensiveSalesCount: number;
    intensiveSalesAgreementAmount: number;
    intensiveSalesIncomeAmount: number;
    conversionPercent: number;
    followUpCount: number;
    stageChangeCount: number;
    overdueFollowUpCount: number;
    todayFollowUpCount: number;
  };
  sellerPerformance: SellerPerformanceRow[];
  updatedAt: string;
};

interface AnalyticsChartsProps {
  data?: DashboardSummaryResponse;
  isLoading?: boolean;
  isError?: boolean;
}

function formatMoney(value: number) {
  return `${Math.round(value || 0).toLocaleString('uz-UZ')} so'm`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '-';
  }
  return `${Number(value).toFixed(2)}%`;
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) {
    return '-';
  }
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function KpiCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-2 text-xl font-semibold ${accent ? 'text-blue-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function CategoryCard({
  title,
  salesCount,
  agreement,
  income,
}: {
  title: string;
  salesCount: number;
  agreement: number;
  income: number;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-2 text-2xl font-bold text-gray-900">{salesCount}</p>
      <p className="mt-2 text-sm text-gray-600">Kelishuv: {formatMoney(agreement)}</p>
      <p className="text-sm text-gray-600">Tushum: {formatMoney(income)}</p>
    </div>
  );
}

export default function AnalyticsCharts({
  data,
  isLoading = false,
  isError = false,
}: AnalyticsChartsProps) {
  const sourceStatus = data?.sourceStatus || {};
  const sourceLabelMap: Record<string, string> = {
    amoContext: 'AmoCRM ulanishi',
    catalog: 'AmoCRM katalog maydonlari',
    leads: 'AmoCRM lidlari',
    activity: 'AmoCRM activity',
    corporateCalls: "Korporativ qo'ng'iroqlar",
  };
  const degradedSources = Object.entries(sourceStatus)
    .filter(([, value]) => value && value.ok === false)
    .map(([key, value]) => ({
      key,
      label: sourceLabelMap[key] || key,
      reason: value?.reason || 'unknown',
      retried: Boolean(value?.retried),
    }));

  const rows = data?.sellerPerformance || [];
  const teamTalkSeconds = rows.reduce((total, row) => total + (row.talkedSeconds || 0), 0);
  const teamCalls = rows.reduce((total, row) => total + (row.callsCount || 0), 0);
  const teamFollowUp = rows.reduce((total, row) => total + (row.followUpCount || 0), 0);
  const teamOverdue = rows.reduce((total, row) => total + (row.overdueFollowUpCount || 0), 0);
  const teamTodayQueue = rows.reduce((total, row) => total + (row.todayFollowUpCount || 0), 0);

  return (
    <div className="space-y-6">
      {isError && !data && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Boshqaruv tahlillarini yuklashda xatolik yuz berdi.
        </div>
      )}

      {degradedSources.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-medium">Ba'zi tashqi manbalar vaqtincha ishlamadi. Asosiy DB ma'lumotlari ko'rsatildi.</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {degradedSources.map((source) => (
              <span
                key={source.key}
                className="inline-flex items-center rounded-full border border-amber-300 bg-white px-2 py-0.5 text-xs text-amber-700"
              >
                {source.label} ({source.reason}{source.retried ? ', retry' : ''})
              </span>
            ))}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="rounded-md border border-gray-200 bg-white px-3 py-3 text-sm text-gray-600">
          Tahlillar yuklanmoqda...
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Jami lidlar" value={(data?.summary.totalLeads || 0).toLocaleString('uz-UZ')} />
        <KpiCard label="Sifatli lidlar" value={(data?.summary.qualifiedLeads || 0).toLocaleString('uz-UZ')} />
        <KpiCard label="Sifatsiz lidlar" value={(data?.summary.nonQualifiedLeads || 0).toLocaleString('uz-UZ')} />
        <KpiCard label="Yangi sotuvlar" value={(data?.summary.newSalesCount || 0).toLocaleString('uz-UZ')} />
        <KpiCard label="Konversiya" value={formatPercent(data?.summary.conversionPercent)} />
        <KpiCard label="Kelishuv summasi" value={formatMoney(data?.summary.newSalesAgreementAmount || 0)} accent />
        <KpiCard label="Tushum" value={formatMoney(data?.summary.totalIncomeAmount || 0)} accent />
        <KpiCard label="Follow-up" value={(data?.summary.followUpCount || 0).toLocaleString('uz-UZ')} />
        <KpiCard label="Bosqich o'zgarishi" value={(data?.summary.stageChangeCount || 0).toLocaleString('uz-UZ')} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CategoryCard
          title="Online"
          salesCount={data?.summary.onlineSalesCount || 0}
          agreement={data?.summary.onlineSalesAgreementAmount || 0}
          income={data?.summary.onlineSalesIncomeAmount || 0}
        />
        <CategoryCard
          title="Offline"
          salesCount={data?.summary.offlineSalesCount || 0}
          agreement={data?.summary.offlineSalesAgreementAmount || 0}
          income={data?.summary.offlineSalesIncomeAmount || 0}
        />
        <CategoryCard
          title="Intensiv"
          salesCount={data?.summary.intensiveSalesCount || 0}
          agreement={data?.summary.intensiveSalesAgreementAmount || 0}
          income={data?.summary.intensiveSalesIncomeAmount || 0}
        />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-base font-semibold text-gray-900">Sotuv jamoasi overview</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="Faol xodimlar" value={rows.length.toLocaleString('uz-UZ')} />
          <KpiCard label="Jami qo'ng'iroqlar" value={teamCalls.toLocaleString('uz-UZ')} />
          <KpiCard label="Jami suhbat vaqti" value={formatDuration(teamTalkSeconds)} />
          <KpiCard label="Muddati o'tgan follow-up" value={teamOverdue.toLocaleString('uz-UZ')} />
          <KpiCard label="Bugungi/navbatdagi follow-up" value={teamTodayQueue.toLocaleString('uz-UZ')} />
        </div>
        <p className="mt-2 text-xs text-gray-500">Jami follow-up: {teamFollowUp.toLocaleString('uz-UZ')}</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-base font-semibold text-gray-900">Agent performance</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Agent</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Yangi lid</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Sifatli lid</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Sotuv</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Konversiya</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Kelishuv</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Tushum</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Qo'ng'iroq</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Suhbat vaqti</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Follow-up</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Bosqich o'zgarishi</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Muddati o'tgan</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Bugungi/navbatdagi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.userId}>
                  <td className="px-3 py-2 text-gray-900">{row.name}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{row.newLeads ?? '-'}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{row.qualifiedLeads ?? '-'}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{row.sales.toLocaleString('uz-UZ')}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{formatPercent(row.conversionPercent)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{formatMoney(row.agreementsAmount)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{formatMoney(row.incomeAmount)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{row.callsCount.toLocaleString('uz-UZ')}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{formatDuration(row.talkedSeconds)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{row.followUpCount.toLocaleString('uz-UZ')}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{row.stageChangeCount.toLocaleString('uz-UZ')}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{row.overdueFollowUpCount.toLocaleString('uz-UZ')}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{row.todayFollowUpCount.toLocaleString('uz-UZ')}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-8 text-center text-gray-500">
                    Tanlangan davr uchun agent ma'lumotlari topilmadi.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-center text-xs text-gray-500">
        Ma'lumot yangilangan vaqt: {data?.updatedAt ? new Date(data.updatedAt).toLocaleString('uz-UZ') : 'Mavjud emas'}
      </p>
    </div>
  );
}
