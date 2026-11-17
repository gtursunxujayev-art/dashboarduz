'use client';

import { IconListDetails, IconPencil, IconTargetArrow, IconTrash } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { getPlanCategoryLabel } from '@/lib/course-categories';
import { formatUzs } from '@/lib/format';
import { getPeriodLabel } from './bonus-helpers';
import type { BonusPlan } from './bonus-helpers';
import { SettingsCard } from './settings-card';
import type { BonusPageModel } from './use-bonus-page';

export function PlanBonusList({ vm }: { vm: BonusPageModel }) {
  const { courseNameById, deletePlan, editingPlanId, handleDeletePlan, handleEditPlan, handleTogglePlan, isAdmin, plans, plansQuery, updatePlan } = vm;

  // The form sits beside the list on wide screens and under it on narrow ones: bring it into view.
  const startEdit = (plan: BonusPlan) => {
    handleEditPlan(plan);
    document.getElementById('plan-bonus-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

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
          <ul className="space-y-3">
            {plans.map((plan) => {
              const editing = editingPlanId === plan.id;
              return (
                <li
                  key={plan.id}
                  className={`rounded-[16px] border p-4 transition sm:p-5 ${
                    editing ? 'border-blue-300 bg-blue-50 shadow-sm' : 'border-gray-100 hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-md'
                  } ${plan.isActive ? '' : 'opacity-80'}`}
                >
                  <div className="flex items-start gap-3.5">
                    <span
                      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
                        plan.isActive ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      <IconTargetArrow className="h-5 w-5" stroke={1.6} />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[15px] font-semibold text-gray-900">{plan.name}</p>
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
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <p className="tabular text-sm font-medium text-gray-800">
                      Maqsad: {plan.targetClosedSales} ta | Bonus: {formatUzs(plan.bonusAmount)}
                    </p>

                    {isAdmin && (
                      <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleTogglePlan(plan)}
                          disabled={updatePlan.isLoading}
                          className="btn btn-ghost btn-sm"
                        >
                          {plan.isActive ? "Nofaol qilish" : 'Faollashtirish'}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(plan)}
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
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={IconListDetails} title="Hozircha plan bonuslar mavjud emas." />
        )}
      </div>
    </SettingsCard>
  );
}
