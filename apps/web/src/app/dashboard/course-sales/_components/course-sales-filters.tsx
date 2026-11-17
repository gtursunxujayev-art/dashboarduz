'use client';

import { IconCalendar, IconSearch } from '@tabler/icons-react';
import type { ReportRangePreset as DashboardRange } from '@dashboarduz/shared';
import type { CourseSalesPageModel } from './use-course-sales-page';

const RANGE_OPTIONS: Array<{ value: DashboardRange; label: string }> = [
  { value: 'today', label: 'Bugun' },
  { value: 'week', label: 'Hafta' },
  { value: 'month', label: 'Oy' },
  { value: 'custom', label: 'Ixtiyoriy' },
];

export function CourseSalesFilters({ vm }: { vm: CourseSalesPageModel }) {
  const { applySearch, clearSearch, courseId, courses, dateFrom, dateTo, range, searchInput, setCourseId, setDateFrom, setDateTo, setRange, setSearchInput, setSubTariffId, setTariffId, subTariffId, subTariffOptions, tariffId, tariffOptions } = vm;

  return (
    <div className="panel space-y-3 p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="segmented max-w-full self-start overflow-x-auto">
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
      </div>

      <div className="flex flex-col gap-3 border-t border-gray-100 pt-3 xl:flex-row xl:items-center">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:flex xl:flex-none">
          <select
            value={courseId}
            onChange={(event) => setCourseId(event.target.value)}
            className="field xl:w-52"
          >
            <option value="">Kurs tanlang</option>
            {(courses as any[]).map((course: any) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>

          <select
            value={tariffId}
            onChange={(event) => setTariffId(event.target.value)}
            disabled={!courseId}
            className="field xl:w-44"
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
            disabled={!courseId}
            className="field xl:w-44"
          >
            <option value="">Barcha subtariflar</option>
            {subTariffOptions.map((subTariff: any) => (
              <option key={subTariff.id} value={subTariff.id}>
                {subTariff.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap gap-2 sm:flex-nowrap">
          <div className="relative min-w-0 flex-1 basis-full sm:basis-auto">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Mijoz raqami yoki ism"
              className="field pl-9"
            />
          </div>
          <button
            type="button"
            onClick={applySearch}
            className="btn btn-primary"
          >
            Qidirish
          </button>
          <button
            type="button"
            onClick={clearSearch}
            className="btn btn-ghost"
          >
            Tozalash
          </button>
        </div>
      </div>
    </div>
  );
}
