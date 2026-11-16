'use client';

import LoadingBlock from '@/components/dashboard/loading-block';
import { getPlanCategoryLabel } from '@/lib/course-categories';
import { formatUzs } from '@/lib/format';
import { getPeriodLabel } from './bonus-helpers';
import type { BonusPageModel } from './use-bonus-page';

export function PlanBonusList({ vm }: { vm: BonusPageModel }) {
  const { courseNameById, deletePlan, handleDeletePlan, handleEditPlan, handleTogglePlan, isAdmin, plans, plansQuery, updatePlan } = vm;

  return (
    <div className="rounded-lg bg-white shadow">
      <div className="border-b border-gray-100 px-6 py-5">
        <h2 className="text-lg font-semibold text-gray-900">Yaratilgan plan bonuslar</h2>
      </div>
      <div className="p-6">
        {plansQuery.isLoading ? (
          <LoadingBlock message="Plan bonuslar yuklanmoqda..." />
        ) : plans.length ? (
          <div className="space-y-3">
            {plans.map((plan) => (
              <div key={plan.id} className="rounded-md border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-gray-900">{plan.name}</p>
                    <p className="text-xs text-gray-600">
                      {getPlanCategoryLabel(plan.courseCategory)} | {getPeriodLabel(plan.periodMode)}
                    </p>
                    <p className="text-xs text-gray-600">
                      Kurs: {plan.courseId ? (courseNameById.get(plan.courseId) || '-') : 'Barchasi'} | Tarif: {plan.tariffId ? (courseNameById.get(plan.tariffId) || '-') : 'Barchasi'} | Subtarif: {plan.subTariffId ? (courseNameById.get(plan.subTariffId) || '-') : (plan.subTariffName || 'Barchasi')}
                    </p>
                    <p className="text-xs text-gray-600">
                      Maqsad: {plan.targetClosedSales} ta | Bonus: {formatUzs(plan.bonusAmount)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${plan.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                      {plan.isActive ? 'Faol' : 'Nofaol'}
                    </span>
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleTogglePlan(plan)}
                          disabled={updatePlan.isLoading}
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          {plan.isActive ? "Nofaol qilish" : 'Faollashtirish'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEditPlan(plan)}
                          className="rounded-md border border-blue-300 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-50"
                        >
                          Tahrirlash
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePlan(plan.id)}
                          disabled={deletePlan.isLoading}
                          className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
                        >
                          O&apos;chirish
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-600">Hozircha plan bonuslar mavjud emas.</p>
        )}
      </div>
    </div>
  );
}
