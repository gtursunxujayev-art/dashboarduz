'use client';

import type { CourseCategory as PlanCategory, PlanBonusPeriodMode as PlanPeriodMode } from '@dashboarduz/shared';
import type { BonusPageModel } from './use-bonus-page';

export function PlanBonusForm({ vm }: { vm: BonusPageModel }) {
  const { catalogQuery, courseOptions, createPlan, editingPlanId, handleSavePlan, isAdmin, planActive, planBonusAmount, planCategory, planCourseId, planError, planName, planPeriodMode, planSubTariffId, planSubTariffName, planSuccess, planTargetClosedSales, planTariffId, plansQuery, resetPlanForm, setPlanActive, setPlanBonusAmount, setPlanCategory, setPlanCourseId, setPlanName, setPlanPeriodMode, setPlanSubTariffId, setPlanSubTariffName, setPlanTargetClosedSales, setPlanTariffId, subTariffOptions, tariffOptions, updatePlan } = vm;

  return (
    <div className="rounded-lg bg-white shadow">
      <div className="border-b border-gray-100 px-6 py-5">
        <h2 className="text-lg font-semibold text-gray-900">Yangi plan bonus qo&apos;shish</h2>
        <p className="mt-1 text-sm text-gray-500">
          Plan: yopilgan sotuv soni maqsadi + qat&apos;iy bonus summasi.
        </p>
      </div>
      <div className="space-y-4 p-6">
        {planError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{planError}</p>}
        {planSuccess && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{planSuccess}</p>}
        {plansQuery.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{plansQuery.error.message}</p>}
        {catalogQuery.error && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">{catalogQuery.error.message}</p>}

        <form onSubmit={handleSavePlan} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Plan nomi</label>
              <input
                value={planName}
                onChange={(event) => setPlanName(event.target.value)}
                disabled={!isAdmin}
                placeholder="Masalan: Online premium 10ta"
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Davr rejimi</label>
              <select
                value={planPeriodMode}
                onChange={(event) => setPlanPeriodMode(event.target.value as PlanPeriodMode)}
                disabled={!isAdmin}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              >
                <option value="monthly">Oylik</option>
                <option value="all_time">Umumiy</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Kurs turi</label>
              <select
                value={planCategory}
                onChange={(event) => {
                  setPlanCategory(event.target.value as PlanCategory);
                  setPlanCourseId('');
                  setPlanTariffId('');
                  setPlanSubTariffId('');
                  setPlanSubTariffName('');
                }}
                disabled={!isAdmin}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              >
                <option value="online">Online</option>
                <option value="offline">Offline</option>
                <option value="intensive">Intensiv</option>
                <option value="additional_service">Qo&apos;shimcha xizmat</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Kurs (ixtiyoriy)</label>
              <select
                value={planCourseId}
                onChange={(event) => {
                  setPlanCourseId(event.target.value);
                  setPlanTariffId('');
                  setPlanSubTariffId('');
                  setPlanSubTariffName('');
                }}
                disabled={!isAdmin}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              >
                <option value="">Barcha kurslar</option>
                {courseOptions.map((course) => (
                  <option key={course.id} value={course.id}>{course.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Tarif (ixtiyoriy)</label>
              <select
                value={planTariffId}
                onChange={(event) => {
                  setPlanTariffId(event.target.value);
                  setPlanSubTariffId('');
                  setPlanSubTariffName('');
                }}
                disabled={!isAdmin || !planCourseId}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              >
                <option value="">Barcha tariflar</option>
                {tariffOptions.map((tariff) => (
                  <option key={tariff.id} value={tariff.id}>{tariff.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Subtarif (ixtiyoriy)</label>
              <select
                value={planTariffId ? planSubTariffId : planSubTariffName}
                onChange={(event) => {
                  if (planTariffId) {
                    setPlanSubTariffId(event.target.value);
                    return;
                  }
                  setPlanSubTariffName(event.target.value);
                }}
                disabled={!isAdmin || !planCourseId}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              >
                <option value="">Barcha subtariflar</option>
                {subTariffOptions.map((subTariff) => (
                  <option key={subTariff.value} value={subTariff.value}>{subTariff.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">Yopilgan sotuv maqsadi</label>
              <input
                value={planTargetClosedSales}
                onChange={(event) => setPlanTargetClosedSales(event.target.value.replace(/[^\d]/g, ''))}
                disabled={!isAdmin}
                inputMode="numeric"
                placeholder="Masalan: 5"
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Bonus summasi (UZS)</label>
              <input
                value={planBonusAmount}
                onChange={(event) => setPlanBonusAmount(event.target.value.replace(/[^\d]/g, ''))}
                disabled={!isAdmin}
                inputMode="numeric"
                placeholder="Masalan: 500000"
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Holat</label>
              <select
                value={planActive ? 'active' : 'inactive'}
                onChange={(event) => setPlanActive(event.target.value === 'active')}
                disabled={!isAdmin}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              >
                <option value="active">Faol</option>
                <option value="inactive">Nofaol</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={!isAdmin || createPlan.isLoading || updatePlan.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {createPlan.isLoading || updatePlan.isLoading
                ? 'Saqlanmoqda...'
                : editingPlanId
                  ? 'Plan bonusni yangilash'
                  : "Yangi plan bonus qo'shish"}
            </button>
            {editingPlanId && (
              <button
                type="button"
                onClick={resetPlanForm}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Bekor qilish
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
