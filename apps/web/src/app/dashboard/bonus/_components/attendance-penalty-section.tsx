'use client';

import { IconClockExclamation } from '@tabler/icons-react';
import type { PenaltyTarget } from '@dashboarduz/shared';
import { SettingRow, SettingsCard, SettingsFooter } from './settings-card';
import type { BonusPageModel } from './use-bonus-page';

export function AttendancePenaltySection({ vm }: { vm: BonusPageModel }) {
  const { attendanceLateTarget, attendanceMissingTarget, attendancePenaltyAbsenceDay, attendancePenaltyCap, attendancePenaltyLateMinute, attendancePenaltyMissingHour, handleSaveAttendancePenaltySettings, isAdmin, salaryConfigQuery, setAttendanceLateTarget, setAttendanceMissingTarget, setAttendancePenaltyAbsenceDay, setAttendancePenaltyCap, setAttendancePenaltyLateMinute, setAttendancePenaltyMissingHour, updateAttendancePenaltySettingsMutation } = vm;

  return (
    <SettingsCard
      id="attendance-penalty"
      icon={IconClockExclamation}
      title="Davomat jarimalari"
      description={<>Face ID davomat ma&apos;lumotlari asosida oylik jarima hisoblash sozlamalari.</>}
    >
      <form onSubmit={handleSaveAttendancePenaltySettings}>
        <div className="panel-body divide-y divide-gray-100">
          <SettingRow label={<label>Kechikish jarimasi (1 daqiqa/UZS)</label>}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                value={attendancePenaltyLateMinute}
                onChange={(event) => setAttendancePenaltyLateMinute(event.target.value.replace(/[^\d]/g, ''))}
                disabled={!isAdmin}
                inputMode="numeric"
                placeholder="0"
                className="field tabular text-right sm:self-end"
              />
              <div>
                <label className="field-label">Jarima manbasi</label>
                <select
                  value={attendanceLateTarget}
                  onChange={(event) => setAttendanceLateTarget(event.target.value as PenaltyTarget)}
                  disabled={!isAdmin}
                  className="field"
                >
                  <option value="fixed">Fiks maosh</option>
                  <option value="kpi">KPI</option>
                </select>
              </div>
            </div>
          </SettingRow>

          <SettingRow label={<label>Yetishmagan vaqt jarimasi (1 soat/UZS)</label>}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                value={attendancePenaltyMissingHour}
                onChange={(event) => setAttendancePenaltyMissingHour(event.target.value.replace(/[^\d]/g, ''))}
                disabled={!isAdmin}
                inputMode="numeric"
                placeholder="0"
                className="field tabular text-right sm:self-end"
              />
              <div>
                <label className="field-label">Jarima manbasi</label>
                <select
                  value={attendanceMissingTarget}
                  onChange={(event) => setAttendanceMissingTarget(event.target.value as PenaltyTarget)}
                  disabled={!isAdmin}
                  className="field"
                >
                  <option value="fixed">Fiks maosh</option>
                  <option value="kpi">KPI</option>
                </select>
              </div>
            </div>
          </SettingRow>

          <SettingRow label={<label>Kelmagan kun jarimasi (1 kun/UZS)</label>}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                value={attendancePenaltyAbsenceDay}
                onChange={(event) => setAttendancePenaltyAbsenceDay(event.target.value.replace(/[^\d]/g, ''))}
                disabled={!isAdmin}
                inputMode="numeric"
                placeholder="0"
                className="field tabular text-right sm:self-end"
              />
              <div>
                <label className="field-label">Jarima manbasi</label>
                <input
                  value="Fiks maoshdan ushlanadi"
                  readOnly
                  className="field bg-gray-50 text-gray-600"
                />
              </div>
            </div>
          </SettingRow>

          <SettingRow label={<label>Oylik maksimal jarima (UZS)</label>}>
            <input
              value={attendancePenaltyCap}
              onChange={(event) => setAttendancePenaltyCap(event.target.value.replace(/[^\d]/g, ''))}
              disabled={!isAdmin}
              inputMode="numeric"
              placeholder="0"
              className="field tabular text-right"
            />
          </SettingRow>
        </div>

        <SettingsFooter>
          <button
            type="submit"
            disabled={!isAdmin || updateAttendancePenaltySettingsMutation.isLoading || salaryConfigQuery.isLoading}
            className="btn btn-primary"
          >
            {updateAttendancePenaltySettingsMutation.isLoading ? 'Saqlanmoqda...' : 'Davomat jarimalarini saqlash'}
          </button>
        </SettingsFooter>
      </form>
    </SettingsCard>
  );
}
