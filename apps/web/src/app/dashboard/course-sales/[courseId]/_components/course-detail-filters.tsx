'use client';

import {
  FilterToolbar,
  PeriodControls,
  TOOLBAR_FIELD,
} from '@/components/dashboard/course-sales/course-sales-kit';
import type { CourseDetailPageModel } from './use-course-detail-page';

/** Pill toolbar for the detail page: period on the left, tariff / sub-tariff on the right. */
export function CourseDetailFilters({ vm }: { vm: CourseDetailPageModel }) {
  const { dateFrom, dateTo, range, setDateFrom, setDateTo, setRange, setSubTariffId, setTariffId, subTariffId, subTariffOptions, tariffId, tariffOptions } = vm;

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

      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 xl:ml-auto xl:flex xl:w-auto xl:flex-none">
        <select
          value={tariffId}
          onChange={(event) => {
            setTariffId(event.target.value);
            setSubTariffId('');
          }}
          className={`${TOOLBAR_FIELD} xl:w-48`}
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
          className={`${TOOLBAR_FIELD} xl:w-48`}
        >
          <option value="">Barcha subtariflar</option>
          {subTariffOptions.map((subTariff: any) => (
            <option key={subTariff.id} value={subTariff.id}>
              {subTariff.name}
            </option>
          ))}
        </select>
      </div>
    </FilterToolbar>
  );
}
