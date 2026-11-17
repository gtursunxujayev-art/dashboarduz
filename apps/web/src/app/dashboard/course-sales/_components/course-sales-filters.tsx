'use client';

import {
  FilterToolbar,
  PeriodControls,
  SearchControls,
  TOOLBAR_FIELD,
  ToolbarDivider,
} from '@/components/dashboard/course-sales/course-sales-kit';
import type { CourseSalesPageModel } from './use-course-sales-page';

/** One pill toolbar: period, course / tariff / sub-tariff and the customer search. */
export function CourseSalesFilters({ vm }: { vm: CourseSalesPageModel }) {
  const { applySearch, clearSearch, courseId, courses, dateFrom, dateTo, range, searchInput, setCourseId, setDateFrom, setDateTo, setRange, setSearchInput, setSubTariffId, setTariffId, subTariffId, subTariffOptions, tariffId, tariffOptions } = vm;

  return (
    <FilterToolbar>
      <PeriodControls
        range={range}
        setRange={setRange}
        dateFrom={dateFrom}
        dateTo={dateTo}
        setDateFrom={setDateFrom}
        setDateTo={setDateTo}
      />

      <ToolbarDivider />

      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3 xl:flex xl:w-auto xl:flex-none">
        <select
          value={courseId}
          onChange={(event) => setCourseId(event.target.value)}
          className={`${TOOLBAR_FIELD} xl:w-52`}
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
          className={`${TOOLBAR_FIELD} xl:w-44`}
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
          className={`${TOOLBAR_FIELD} xl:w-44`}
        >
          <option value="">Barcha subtariflar</option>
          {subTariffOptions.map((subTariff: any) => (
            <option key={subTariff.id} value={subTariff.id}>
              {subTariff.name}
            </option>
          ))}
        </select>
      </div>

      <SearchControls
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        applySearch={applySearch}
        clearSearch={clearSearch}
        className="w-full 2xl:w-auto 2xl:min-w-[340px] 2xl:flex-1"
      />
    </FilterToolbar>
  );
}
