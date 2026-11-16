'use client';

import type { PenaltyTarget } from '@dashboarduz/shared';
import type { BonusPageModel } from './use-bonus-page';

export function AttendancePenaltySection({ vm }: { vm: BonusPageModel }) {
  const { attendanceLateTarget, attendanceMissingTarget, attendancePenaltyAbsenceDay, attendancePenaltyCap, attendancePenaltyLateMinute, attendancePenaltyMissingHour, handleSaveAttendancePenaltySettings, isAdmin, salaryConfigQuery, setAttendanceLateTarget, setAttendanceMissingTarget, setAttendancePenaltyAbsenceDay, setAttendancePenaltyCap, setAttendancePenaltyLateMinute, setAttendancePenaltyMissingHour, updateAttendancePenaltySettingsMutation } = vm;

  return (
    <div className="rounded-lg bg-white shadow">
      <div className="border-b border-gray-100 px-6 py-5">
        <h2 className="text-lg font-semibold text-gray-900">Davomat jarimalari</h2>
        <p className="mt-1 text-sm text-gray-500">
          Face ID davomat ma&apos;lumotlari asosida oylik jarima hisoblash sozlamalari.
        </p>
      </div>
      <div className="p-6">
        <form onSubmit={handleSaveAttendancePenaltySettings} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Kechikish jarimasi (1 daqiqa/UZS)</label>
              <input
                value={attendancePenaltyLateMinute}
                onChange={(event) => setAttendancePenaltyLateMinute(event.target.value.replace(/[^\d]/g, ''))}
                disabled={!isAdmin}
                inputMode="numeric"
                placeholder="0"
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              />
              <label className="mt-2 block text-xs font-medium text-gray-600">Jarima manbasi</label>
              <select
                value={attendanceLateTarget}
                onChange={(event) => setAttendanceLateTarget(event.target.value as PenaltyTarget)}
                disabled={!isAdmin}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              >
                <option value="fixed">Fiks maosh</option>
                <option value="kpi">KPI</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Yetishmagan vaqt jarimasi (1 soat/UZS)</label>
              <input
                value={attendancePenaltyMissingHour}
                onChange={(event) => setAttendancePenaltyMissingHour(event.target.value.replace(/[^\d]/g, ''))}
                disabled={!isAdmin}
                inputMode="numeric"
                placeholder="0"
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              />
              <label className="mt-2 block text-xs font-medium text-gray-600">Jarima manbasi</label>
              <select
                value={attendanceMissingTarget}
                onChange={(event) => setAttendanceMissingTarget(event.target.value as PenaltyTarget)}
                disabled={!isAdmin}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              >
                <option value="fixed">Fiks maosh</option>
                <option value="kpi">KPI</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Kelmagan kun jarimasi (1 kun/UZS)</label>
              <input
                value={attendancePenaltyAbsenceDay}
                onChange={(event) => setAttendancePenaltyAbsenceDay(event.target.value.replace(/[^\d]/g, ''))}
                disabled={!isAdmin}
                inputMode="numeric"
                placeholder="0"
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              />
              <label className="mt-2 block text-xs font-medium text-gray-600">Jarima manbasi</label>
              <input
                value="Fiks maoshdan ushlanadi"
                readOnly
                className="mt-1 w-full rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-gray-700"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Oylik maksimal jarima (UZS)</label>
              <input
                value={attendancePenaltyCap}
                onChange={(event) => setAttendancePenaltyCap(event.target.value.replace(/[^\d]/g, ''))}
                disabled={!isAdmin}
                inputMode="numeric"
                placeholder="0"
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={!isAdmin || updateAttendancePenaltySettingsMutation.isLoading || salaryConfigQuery.isLoading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {updateAttendancePenaltySettingsMutation.isLoading ? 'Saqlanmoqda...' : 'Davomat jarimalarini saqlash'}
          </button>
        </form>
      </div>
    </div>
  );
}
