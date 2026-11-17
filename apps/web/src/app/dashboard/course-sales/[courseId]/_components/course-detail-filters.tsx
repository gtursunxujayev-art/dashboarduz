'use client';

import { IconCalendar } from '@tabler/icons-react';
import type { ReportRangePreset as DashboardRange } from '@dashboarduz/shared';
import type { CourseDetailPageModel } from './use-course-detail-page';

const RANGE_OPTIONS: Array<{ value: DashboardRange; label: string }> = [
  { value: 'today', label: 'Bugun' },
  { value: 'week', label: 'Hafta' },
  { value: 'month', label: 'Oy' },
  { value: 'custom', label: 'Ixtiyoriy' },
];

export function CourseDetailFilters({ vm }: { vm: CourseDetailPageModel }) {
  const { dateFrom, dateTo, range, setDateFrom, setDateTo, setRange, setSubTariffId, setTariffId, subTariffId, subTariffOptions, tariffId, tariffOptions } = vm;

  return (
    <div className="panel p-3 sm:p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="segmented max-w-full self-start overflow-x-auto xl:self-auto">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setRange(option.value)}
              aria-pressed={range === option.value}
              className={`segmented-item ${range === option.value ? 'segmented-item-active' : ''}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <IconCalendar className="hidden h-4 w-4 flex-shrink-0 text-gray-400 sm:block" stroke={1.8} />
          <input
            type="date"
            value={dateFrom}
            disabled={range !== 'custom'}
            onChange={(event) => setDateFrom(event.target.value)}
            className="field sm:w-40"
          />
          <input
            type="date"
            value={dateTo}
            disabled={range !== 'custom'}
            onChange={(event) => setDateTo(event.target.value)}
            className="field sm:w-40"
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:ml-auto xl:flex xl:flex-none">
          <select
            value={tariffId}
            onChange={(event) => {
              setTariffId(event.target.value);
              setSubTariffId('');
            }}
            className="field xl:w-48"
          >
            <option value="">Barcha tariflar</option>
            {tariffOptions.map((tariff: any) => (
              <option key={tariff.id} value={tariff.id}>
                {tariff.name}
              </option>
            ))}
          </select>

          <select
            value={subTariffId}
            onChange={(event) => setSubTariffId(event.target.value)}
            className="field xl:w-48"
          >
            <option value="">Barcha subtariflar</option>
            {subTariffOptions.map((subTariff: any) => (
              <option key={subTariff.id} value={subTariff.id}>
                {subTariff.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
