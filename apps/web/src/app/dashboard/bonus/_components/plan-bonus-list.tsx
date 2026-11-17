'use client';

import { IconListDetails, IconPencil, IconTrash } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { getPlanCategoryLabel } from '@/lib/course-categories';
import { formatUzs } from '@/lib/format';
import { getPeriodLabel } from './bonus-helpers';
import { SettingsCard } from './settings-card';
import type { BonusPageModel } from './use-bonus-page';

export function PlanBonusList({ vm }: { vm: BonusPageModel }) {
  const { courseNameById, deletePlan, handleDeletePlan, handleEditPlan, handleTogglePlan, isAdmin, plans, plansQuery, updatePlan } = vm;

  return (
    <SettingsCard
      id="plan-bonus-list"
      icon={IconListDetails}
      title="Yaratilgan plan bonuslar"
      aside={plans.length ? <span className="badge badge-neutral tabular">{plans.length}</span> : null}
    >
      <div className="panel-body">
        {plansQuery.isLoading ? (
          <LoadingBlock message="Plan bonuslar yuklanmoqda..." />
        ) : plans.length ? (
          <div className="divide-y divide-gray-100">
            {plans.map((plan) => (
              <div key={plan.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900">{plan.name}</p>
                    <span className={plan.isActive ? 'badge badge-green' : 'badge badge-neutral'}>
                      {plan.isActive ? 'Faol' : 'Nofaol'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">
                    {getPlanCategoryLabel(plan.courseCategory)} | {getPeriodLabel(plan.periodMode)}
                  </p>
                  <p className="text-xs text-gray-500">
                    Kurs: {plan.courseId ? (courseNameById.get(plan.courseId) || '-') : 'Barchasi'} | Tarif: {plan.tariffId ? (courseNameById.get(plan.tariffId) || '-') : 'Barchasi'} | Subtarif: {plan.subTariffId ? (courseNameById.get(plan.subTariffId) || '-') : (plan.subTariffName || 'Barchasi')}
                  </p>
                  <p className="tabular text-xs font-medium text-gray-700">
                    Maqsad: {plan.targetClosedSales} ta | Bonus: {formatUzs(plan.bonusAmount)}
                  </p>
                </div>

                {isAdmin && (
                  <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleTogglePlan(plan)}
                      disabled={updatePlan.isLoading}
                      className="btn btn-secondary btn-sm"
                    >
                      {plan.isActive ? "Nofaol qilish" : 'Faollashtirish'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEditPlan(plan)}
                      className="btn btn-soft btn-sm"
                    >
                      <IconPencil className="h-4 w-4" stroke={1.8} />
                      Tahrirlash
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePlan(plan.id)}
                      disabled={deletePlan.isLoading}
                      className="btn btn-danger-soft btn-sm"
                    >
                      <IconTrash className="h-4 w-4" stroke={1.8} />
                      O&apos;chirish
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={IconListDetails} title="Hozircha plan bonuslar mavjud emas." />
        )}
      </div>
    </SettingsCard>
  );
}
