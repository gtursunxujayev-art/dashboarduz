'use client';

import { IconTargetArrow } from '@tabler/icons-react';
import type { CourseCategory as PlanCategory, PlanBonusPeriodMode as PlanPeriodMode } from '@dashboarduz/shared';
import { SettingsCard, SettingsFooter } from './settings-card';
import type { BonusPageModel } from './use-bonus-page';

export function PlanBonusForm({ vm }: { vm: BonusPageModel }) {
  const { catalogQuery, courseOptions, createPlan, editingPlanId, handleSavePlan, isAdmin, planActive, planBonusAmount, planCategory, planCourseId, planError, planName, planPeriodMode, planSubTariffId, planSubTariffName, planSuccess, planTargetClosedSales, planTariffId, plansQuery, resetPlanForm, setPlanActive, setPlanBonusAmount, setPlanCategory, setPlanCourseId, setPlanName, setPlanPeriodMode, setPlanSubTariffId, setPlanSubTariffName, setPlanTargetClosedSales, setPlanTariffId, subTariffOptions, tariffOptions, updatePlan } = vm;

  return (
    <SettingsCard
      id="plan-bonus-form"
      icon={IconTargetArrow}
      title={<>Yangi plan bonus qo&apos;shish</>}
      description={<>Plan: yopilgan sotuv soni maqsadi + qat&apos;iy bonus summasi.</>}
    >
      <form onSubmit={handleSavePlan}>
        <div className="panel-body space-y-5">
          {(planError || planSuccess || plansQuery.error || catalogQuery.error) && (
            <div className="space-y-3">
              {planError && <p className="alert alert-error">{planError}</p>}
              {planSuccess && <p className="alert alert-success">{planSuccess}</p>}
              {plansQuery.error && <p className="alert alert-error">{plansQuery.error.message}</p>}
              {catalogQuery.error && <p className="alert alert-warning">{catalogQuery.error.message}</p>}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="field-label">Plan nomi</label>
              <input
                value={planName}
                onChange={(event) => setPlanName(event.target.value)}
                disabled={!isAdmin}
                placeholder="Masalan: Online premium 10ta"
                className="field"
              />
            </div>
            <div>
              <label className="field-label">Davr rejimi</label>
              <select
                value={planPeriodMode}
                onChange={(event) => setPlanPeriodMode(event.target.value as PlanPeriodMode)}
                disabled={!isAdmin}
                className="field"
              >
                <option value="monthly">Oylik</option>
                <option value="all_time">Umumiy</option>
              </select>
            </div>
          </div>

          <div className="panel-inset grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="field-label">Kurs turi</label>
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
                className="field"
              >
                <option value="online">Online</option>
                <option value="offline">Offline</option>
                <option value="intensive">Intensiv</option>
                <option value="additional_service">Qo&apos;shimcha xizmat</option>
              </select>
            </div>
            <div>
              <label className="field-label">Kurs (ixtiyoriy)</label>
              <select
                value={planCourseId}
                onChange={(event) => {
                  setPlanCourseId(event.target.value);
                  setPlanTariffId('');
                  setPlanSubTariffId('');
                  setPlanSubTariffName('');
                }}
                disabled={!isAdmin}
                className="field"
              >
                <option value="">Barcha kurslar</option>
                {courseOptions.map((course) => (
                  <option key={course.id} value={course.id}>{course.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Tarif (ixtiyoriy)</label>
              <select
                value={planTariffId}
                onChange={(event) => {
                  setPlanTariffId(event.target.value);
                  setPlanSubTariffId('');
                  setPlanSubTariffName('');
                }}
                disabled={!isAdmin || !planCourseId}
                className="field"
              >
                <option value="">Barcha tariflar</option>
                {tariffOptions.map((tariff) => (
                  <option key={tariff.id} value={tariff.id}>{tariff.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Subtarif (ixtiyoriy)</label>
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
                className="field"
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
              <label className="field-label">Yopilgan sotuv maqsadi</label>
              <input
                value={planTargetClosedSales}
                onChange={(event) => setPlanTargetClosedSales(event.target.value.replace(/[^\d]/g, ''))}
                disabled={!isAdmin}
                inputMode="numeric"
                placeholder="Masalan: 5"
                className="field tabular"
              />
            </div>
            <div>
              <label className="field-label">Bonus summasi (UZS)</label>
              <input
                value={planBonusAmount}
                onChange={(event) => setPlanBonusAmount(event.target.value.replace(/[^\d]/g, ''))}
                disabled={!isAdmin}
                inputMode="numeric"
                placeholder="Masalan: 500000"
                className="field tabular"
              />
            </div>
            <div>
              <label className="field-label">Holat</label>
              <select
                value={planActive ? 'active' : 'inactive'}
                onChange={(event) => setPlanActive(event.target.value === 'active')}
                disabled={!isAdmin}
                className="field"
              >
                <option value="active">Faol</option>
                <option value="inactive">Nofaol</option>
              </select>
            </div>
          </div>
        </div>

        <SettingsFooter>
          {editingPlanId && (
            <button
              type="button"
              onClick={resetPlanForm}
              className="btn btn-secondary"
            >
              Bekor qilish
            </button>
          )}
          <button
            type="submit"
            disabled={!isAdmin || createPlan.isLoading || updatePlan.isLoading}
            className="btn btn-primary"
          >
            {createPlan.isLoading || updatePlan.isLoading
              ? 'Saqlanmoqda...'
              : editingPlanId
                ? 'Plan bonusni yangilash'
                : "Yangi plan bonus qo'shish"}
          </button>
        </SettingsFooter>
      </form>
    </SettingsCard>
  );
}
