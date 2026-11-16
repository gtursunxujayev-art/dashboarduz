'use client';

import type { ReportRangePreset as DashboardRange } from '@dashboarduz/shared';
import type { CourseSalesPageModel } from './use-course-sales-page';

export function CourseSalesFilters({ vm }: { vm: CourseSalesPageModel }) {
  const { applySearch, clearSearch, courseId, courses, dateFrom, dateTo, range, searchInput, setCourseId, setDateFrom, setDateTo, setRange, setSearchInput, setSubTariffId, setTariffId, subTariffId, subTariffOptions, tariffId, tariffOptions } = vm;

  return (
    <div className="rounded-lg bg-white p-5 shadow">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_180px_180px_1fr_1fr]">
        <select
          value={range}
          onChange={(event) => setRange(event.target.value as DashboardRange)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
        >
          <option value="today">Bugun</option>
          <option value="week">Hafta</option>
          <option value="month">Oy</option>
          <option value="custom">Ixtiyoriy</option>
        </select>

        <input
          type="date"
          value={dateFrom}
          disabled={range !== 'custom'}
          onChange={(event) => setDateFrom(event.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
        />
        <input
          type="date"
          value={dateTo}
          disabled={range !== 'custom'}
          onChange={(event) => setDateTo(event.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
        />

        <select
          value={courseId}
          onChange={(event) => setCourseId(event.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
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
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
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
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
        >
          <option value="">Barcha subtariflar</option>
          {subTariffOptions.map((subTariff: any) => (
            <option key={subTariff.id} value={subTariff.id}>
              {subTariff.name}
            </option>
          ))}
        </select>

        <div className="md:col-span-2 flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Mijoz raqami yoki ism"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          />
          <button
            type="button"
            onClick={applySearch}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Qidirish
          </button>
          <button
            type="button"
            onClick={clearSearch}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Tozalash
          </button>
        </div>
      </div>
    </div>
  );
}
