'use client';

import LoadingBlock from '@/components/dashboard/loading-block';

type Props = {
  showSalarySection: boolean;
  isLoading: boolean;
  error: { message: string } | null;
  isAgentOnly: boolean;
  isTeamLeaderView?: boolean;
  salaryCurrentUser: any;
  salaryByAgent: any[];
  salaryTotals: any;
  salaryModeLabel: string;
  formatAmount: (value?: number | null) => string;
};

export default function DashboardSalarySection({
  showSalarySection,
  isLoading,
  error,
  isAgentOnly,
  isTeamLeaderView = false,
  salaryCurrentUser,
  salaryByAgent,
  salaryTotals,
  salaryModeLabel,
  formatAmount,
}: Props) {
  if (!showSalarySection) {
    return null;
  }

  return (
    <div className="rounded-lg bg-white shadow">
      <div className="px-4 py-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium leading-6 text-gray-900">Maosh (joriy oy)</h3>
            <p className="mt-1 text-sm text-gray-500">{salaryModeLabel}</p>
          </div>
        </div>

        {error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error.message || 'Maosh ma\'lumotini yuklashda xatolik.'}
          </div>
        )}

        {isLoading ? (
          <LoadingBlock message="Maosh ma'lumotlari yuklanmoqda..." />
        ) : isAgentOnly || isTeamLeaderView ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">Fiks maosh</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryCurrentUser?.fixedSalary)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">KPI</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryCurrentUser?.kpiAmount)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">Bonus</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryCurrentUser?.bonusAmount)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">Plan Bonus</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryCurrentUser?.planBonusAmount)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">Jami maosh</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryCurrentUser?.totalSalary)}</p>
              </div>
            </div>

            {isAgentOnly && (
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h4 className="text-sm font-semibold text-gray-900">Plan bonuslar</h4>
                {Array.isArray(salaryCurrentUser?.planProgress) && salaryCurrentUser.planProgress.length ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Plan</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Fakt</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Bajarilish</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Ishlangan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {salaryCurrentUser.planProgress.map((plan: any) => (
                          <tr key={plan.planId}>
                            <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{plan.name}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{plan.fact}/{plan.target}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{(plan.completionPercent ?? 0).toFixed(1)}%</td>
                            <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(plan.earnedAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-gray-600">Faol plan bonus topilmadi.</p>
                )}
              </div>
            )}

            {isTeamLeaderView && (
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h4 className="text-sm font-semibold text-gray-900">Faol foydalanuvchilar bonusi</h4>
                {salaryByAgent.length ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Xodim</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Fiks</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">KPI</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Bonus</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Plan bonus</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Jami</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {salaryByAgent.map((row: any) => (
                          <tr key={row.userId}>
                            <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{row.name}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.fixedSalary)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.kpiAmount)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.bonusAmount)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.planBonusAmount)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-gray-900">{formatAmount(row.totalSalary)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-gray-600">Faol xodimlar bo'yicha bonus topilmadi.</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">Jami fiks maosh</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryTotals?.fixedSalary)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">Jami KPI</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryTotals?.kpi)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">Jami bonus</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryTotals?.bonus)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">Jami plan bonus</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryTotals?.planBonus)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">Jami maosh to'lovi</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryTotals?.salary)}</p>
              </div>
            </div>

            {salaryByAgent.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Agent</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Fiks</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">KPI</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Bonus</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Plan bonus</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Jami</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {salaryByAgent.map((row: any) => (
                      <tr key={row.userId}>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{row.name}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.fixedSalary)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.kpiAmount)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.bonusAmount)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.planBonusAmount)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-gray-900">{formatAmount(row.totalSalary)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-600">Joriy oy bo'yicha agent maoshi topilmadi.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
