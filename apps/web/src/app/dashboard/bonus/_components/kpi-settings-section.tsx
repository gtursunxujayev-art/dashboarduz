'use client';

import { KPI_METRICS } from './bonus-helpers';
import type { BonusPageModel } from './use-bonus-page';

export function KpiSettingsSection({ vm }: { vm: BonusPageModel }) {
  const { handleKpiMetricSlotChange, handleSaveKpiSettings, isAdmin, kpiMetricSlots, kpiMonthlyAmount, kpiThresholds, salaryConfigQuery, selectedKpiMetrics, setKpiMonthlyAmount, setKpiThresholds, updateKpiSettingsMutation } = vm;

  return (
    <div className="rounded-lg bg-white shadow">
      <div className="border-b border-gray-100 px-6 py-5">
        <h2 className="text-lg font-semibold text-gray-900">KPI sozlamalari</h2>
        <p className="mt-1 text-sm text-gray-500">Oylik KPI summasi va baholash ko&apos;rsatkichlarini belgilang.</p>
      </div>
      <div className="p-6">
        <form onSubmit={handleSaveKpiSettings} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Oylik KPI summasi (UZS)</label>
              <input
                value={kpiMonthlyAmount}
                onChange={(event) => setKpiMonthlyAmount(event.target.value.replace(/[^\d]/g, ''))}
                disabled={!isAdmin}
                inputMode="numeric"
                placeholder="0"
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Tanlangan KPI ko&apos;rsatkichlari (maks. 4)</label>
              <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[0, 1, 2, 3].map((slotIndex) => (
                  <select
                    key={slotIndex}
                    value={kpiMetricSlots[slotIndex] || ''}
                    onChange={(event) => handleKpiMetricSlotChange(slotIndex, event.target.value)}
                    disabled={!isAdmin}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    <option value="">Tanlanmagan</option>
                    {KPI_METRICS.map((metric) => {
                      const selectedElsewhere = kpiMetricSlots.some((value, index) => index !== slotIndex && value === metric.key);
                      return (
                        <option key={metric.key} value={metric.key} disabled={selectedElsewhere}>
                          {metric.label}
                        </option>
                      );
                    })}
                  </select>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {selectedKpiMetrics.map((metric) => (
              <div key={metric} className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <p className="text-sm font-medium text-gray-800">{KPI_METRICS.find((item) => item.key === metric)?.label || metric}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    value={kpiThresholds[metric]?.half || ''}
                    onChange={(event) => {
                      const nextValue = event.target.value.replace(/[^\d]/g, '');
                      setKpiThresholds((prev) => ({ ...prev, [metric]: { ...prev[metric], half: nextValue } }));
                    }}
                    disabled={!isAdmin}
                    inputMode="numeric"
                    placeholder="Half target"
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                  />
                  <input
                    value={kpiThresholds[metric]?.full || ''}
                    onChange={(event) => {
                      const nextValue = event.target.value.replace(/[^\d]/g, '');
                      setKpiThresholds((prev) => ({ ...prev, [metric]: { ...prev[metric], full: nextValue } }));
                    }}
                    disabled={!isAdmin}
                    inputMode="numeric"
                    placeholder="Full target"
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">Tanlanganda ulushi: {selectedKpiMetrics.length ? `${(100 / selectedKpiMetrics.length).toFixed(2)}%` : '0%'}</p>
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={!isAdmin || updateKpiSettingsMutation.isLoading || salaryConfigQuery.isLoading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {updateKpiSettingsMutation.isLoading ? 'Saqlanmoqda...' : 'KPI sozlamalarini saqlash'}
          </button>
        </form>
      </div>
    </div>
  );
}
