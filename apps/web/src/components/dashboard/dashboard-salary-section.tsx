'use client';

import { IconCoins, IconGauge, IconTargetArrow, IconUsers, IconWallet, IconCash } from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';

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

function SalaryByPersonTable({
  rows,
  nameHeader,
  formatAmount,
}: {
  rows: Props['salaryByAgent'];
  nameHeader: string;
  formatAmount: (value?: number | null) => string;
}) {
  return (
    <div className="overflow-x-auto rounded-[16px] border border-gray-100">
      <table className="data-table">
        <thead>
          <tr>
            <th className="text-left">{nameHeader}</th>
            <th className="text-right">Fiks</th>
            <th className="text-right">KPI</th>
            <th className="text-right">Bonus</th>
            <th className="text-right">Plan bonus</th>
            <th className="text-right">Jami</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.userId}>
              <td>
                <div className="flex items-center gap-2.5">
                  <UserAvatar name={row.name || '?'} size="sm" />
                  <span className="whitespace-nowrap font-medium text-gray-900">{row.name}</span>
                </div>
              </td>
              <td className="tabular whitespace-nowrap text-right">{formatAmount(row.fixedSalary)}</td>
              <td className="tabular whitespace-nowrap text-right">{formatAmount(row.kpiAmount)}</td>
              <td className="tabular whitespace-nowrap text-right">{formatAmount(row.bonusAmount)}</td>
              <td className="tabular whitespace-nowrap text-right">{formatAmount(row.planBonusAmount)}</td>
              <td className="tabular whitespace-nowrap text-right font-semibold text-gray-900">{formatAmount(row.totalSalary)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SalaryFigures({
  items,
}: {
  items: { label: string; value: string; icon: Icon; accent?: boolean }[];
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      {items.map(({ label, value, icon: FigureIcon, accent }) => (
        <div
          key={label}
          className={`flex min-w-0 flex-col justify-between gap-3 rounded-[16px] p-4 ${accent ? 'bg-blue-600 text-white shadow-[0_10px_24px_-12px_rgb(34_72_226/0.7)]' : 'bg-gray-50'}`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className={accent ? 'text-[11px] font-medium uppercase tracking-[0.08em] text-white/75' : 'caption'}>{label}</p>
            <span
              className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${accent ? 'bg-white/15 text-white' : 'bg-white text-gray-500 shadow-sm'}`}
              aria-hidden="true"
            >
              <FigureIcon className="h-4 w-4" stroke={1.8} />
            </span>
          </div>
          <p className={`tabular truncate text-[22px] font-semibold leading-none tracking-[-0.02em] ${accent ? 'text-white' : 'text-gray-900'}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

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
    <section className="panel">
      <div className="panel-header items-start">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <IconWallet className="h-5 w-5" stroke={1.6} />
          </span>
          <div className="min-w-0">
            <h3 className="section-title">Maosh (joriy oy)</h3>
            <p className="mt-0.5 text-sm text-gray-500">{salaryModeLabel}</p>
          </div>
        </div>
      </div>

      <div className="panel-body space-y-5">
        {error && (
          <div className="alert alert-error">
            {error.message || 'Maosh ma\'lumotini yuklashda xatolik.'}
          </div>
        )}

        {isLoading ? (
          <LoadingBlock message="Maosh ma'lumotlari yuklanmoqda..." />
        ) : isAgentOnly || isTeamLeaderView ? (
          <div className="space-y-5">
            <SalaryFigures
              items={[
                { label: 'Fiks maosh', value: formatAmount(salaryCurrentUser?.fixedSalary), icon: IconWallet },
                { label: 'KPI', value: formatAmount(salaryCurrentUser?.kpiAmount), icon: IconGauge },
                { label: 'Bonus', value: formatAmount(salaryCurrentUser?.bonusAmount), icon: IconCoins },
                { label: 'Plan Bonus', value: formatAmount(salaryCurrentUser?.planBonusAmount), icon: IconTargetArrow },
                { label: 'Jami maosh', value: formatAmount(salaryCurrentUser?.totalSalary), icon: IconCash, accent: true },
              ]}
            />

            {isAgentOnly && (
              <div className="space-y-3">
                <h4 className="caption">Plan bonuslar</h4>
                {Array.isArray(salaryCurrentUser?.planProgress) && salaryCurrentUser.planProgress.length ? (
                  <div className="overflow-x-auto rounded-[16px] border border-gray-100">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th className="text-left">Plan</th>
                          <th className="text-right">Fakt</th>
                          <th className="text-left">Bajarilish</th>
                          <th className="text-right">Ishlangan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {salaryCurrentUser.planProgress.map((plan: any) => (
                          <tr key={plan.planId}>
                            <td className="whitespace-nowrap font-medium text-gray-900">{plan.name}</td>
                            <td className="tabular whitespace-nowrap text-right">{plan.fact}/{plan.target}</td>
                            <td className="whitespace-nowrap">
                              <div className="flex items-center gap-2.5">
                                <span className="h-2 w-24 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                                  <span
                                    className="block h-full rounded-full bg-blue-600"
                                    style={{ width: `${Math.min(100, Math.max(0, plan.completionPercent ?? 0))}%` }}
                                  />
                                </span>
                                <span className="tabular">{(plan.completionPercent ?? 0).toFixed(1)}%</span>
                              </div>
                            </td>
                            <td className="tabular whitespace-nowrap text-right font-semibold text-gray-900">{formatAmount(plan.earnedAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState icon={IconTargetArrow} title="Faol plan bonus topilmadi." />
                )}
              </div>
            )}

            {isTeamLeaderView && (
              <div className="space-y-3">
                <h4 className="caption">Faol foydalanuvchilar bonusi</h4>
                {salaryByAgent.length ? (
                  <SalaryByPersonTable rows={salaryByAgent} nameHeader="Xodim" formatAmount={formatAmount} />
                ) : (
                  <EmptyState icon={IconUsers} title="Faol xodimlar bo'yicha bonus topilmadi." />
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <SalaryFigures
              items={[
                { label: 'Jami fiks maosh', value: formatAmount(salaryTotals?.fixedSalary), icon: IconWallet },
                { label: 'Jami KPI', value: formatAmount(salaryTotals?.kpi), icon: IconGauge },
                { label: 'Jami bonus', value: formatAmount(salaryTotals?.bonus), icon: IconCoins },
                { label: 'Jami plan bonus', value: formatAmount(salaryTotals?.planBonus), icon: IconTargetArrow },
                { label: "Jami maosh to'lovi", value: formatAmount(salaryTotals?.salary), icon: IconCash, accent: true },
              ]}
            />

            {salaryByAgent.length ? (
              <SalaryByPersonTable rows={salaryByAgent} nameHeader="Agent" formatAmount={formatAmount} />
            ) : (
              <EmptyState icon={IconUsers} title="Joriy oy bo'yicha agent maoshi topilmadi." />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
