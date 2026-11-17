'use client';

import { IconGauge } from '@tabler/icons-react';
import { KPI_METRICS } from './bonus-helpers';
import { SettingRow, SettingsCard, SettingsFooter } from './settings-card';
import type { BonusPageModel } from './use-bonus-page';

export function KpiSettingsSection({ vm }: { vm: BonusPageModel }) {
  const { handleKpiMetricSlotChange, handleSaveKpiSettings, isAdmin, kpiMetricSlots, kpiMonthlyAmount, kpiThresholds, salaryConfigQuery, selectedKpiMetrics, setKpiMonthlyAmount, setKpiThresholds, updateKpiSettingsMutation } = vm;

  return (
    <SettingsCard
      id="kpi-settings"
      icon={IconGauge}
      title="KPI sozlamalari"
      description={<>Oylik KPI summasi va baholash ko&apos;rsatkichlarini belgilang.</>}
    >
      <form onSubmit={handleSaveKpiSettings}>
        <div className="panel-body space-y-5">
          <div className="divide-y divide-gray-100">
            <SettingRow label={<label>Oylik KPI summasi (UZS)</label>}>
              <input
                value={kpiMonthlyAmount}
                onChange={(event) => setKpiMonthlyAmount(event.target.value.replace(/[^\d]/g, ''))}
                disabled={!isAdmin}
                inputMode="numeric"
                placeholder="0"
                className="field tabular text-right"
              />
            </SettingRow>
            <SettingRow label={<label>Tanlangan KPI ko&apos;rsatkichlari (maks. 4)</label>}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[0, 1, 2, 3].map((slotIndex) => (
                  <select
                    key={slotIndex}
                    value={kpiMetricSlots[slotIndex] || ''}
                    onChange={(event) => handleKpiMetricSlotChange(slotIndex, event.target.value)}
                    disabled={!isAdmin}
                    className="field"
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
            </SettingRow>
          </div>

          {selectedKpiMetrics.length > 0 && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {selectedKpiMetrics.map((metric) => (
                <div key={metric} className="panel-inset">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-gray-900">{KPI_METRICS.find((item) => item.key === metric)?.label || metric}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <input
                      value={kpiThresholds[metric]?.half || ''}
                      onChange={(event) => {
                        const nextValue = event.target.value.replace(/[^\d]/g, '');
                        setKpiThresholds((prev) => ({ ...prev, [metric]: { ...prev[metric], half: nextValue } }));
                      }}
                      disabled={!isAdmin}
                      inputMode="numeric"
                      placeholder="Half target"
                      className="field tabular"
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
                      className="field tabular"
                    />
                  </div>
                  <p className="mt-2 text-xs text-gray-500">Tanlanganda ulushi: {selectedKpiMetrics.length ? `${(100 / selectedKpiMetrics.length).toFixed(2)}%` : '0%'}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <SettingsFooter>
          <button
            type="submit"
            disabled={!isAdmin || updateKpiSettingsMutation.isLoading || salaryConfigQuery.isLoading}
            className="btn btn-primary"
          >
            {updateKpiSettingsMutation.isLoading ? 'Saqlanmoqda...' : 'KPI sozlamalarini saqlash'}
          </button>
        </SettingsFooter>
      </form>
    </SettingsCard>
  );
}
