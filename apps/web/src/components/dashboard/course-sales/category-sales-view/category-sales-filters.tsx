'use client';

import { FilterToolbar, SearchControls, TOOLBAR_FIELD, ToolbarDivider } from '../course-sales-kit';
import type { CategorySalesViewModel } from './use-category-sales-view';

/** One pill toolbar: customer search, then course / tariff / sub-tariff. */
export function CategorySalesFilters({ vm }: { vm: CategorySalesViewModel }) {
  const { applySearch, clearSearch, courseId, courses, searchInput, setCourseId, setSearchInput, setSubTariffId, setTariffId, subTariffId, subTariffOptions, tariffId, tariffOptions } = vm;

  return (
    <FilterToolbar>
      <SearchControls
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        applySearch={applySearch}
        clearSearch={clearSearch}
        className="w-full xl:w-auto xl:min-w-[320px] xl:flex-1"
      />

      <ToolbarDivider />

      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3 xl:flex xl:w-auto xl:flex-none">
        <select
          value={courseId}
          onChange={(event) => {
            setCourseId(event.target.value);
            setTariffId('');
            setSubTariffId('');
          }}
          className={`${TOOLBAR_FIELD} xl:w-52`}
        >
          <option value="">Barcha kurslar</option>
          {(courses as any[]).map((course: any) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>

        <select
          value={tariffId}
          onChange={(event) => {
            setTariffId(event.target.value);
            setSubTariffId('');
          }}
          className={`${TOOLBAR_FIELD} xl:w-44`}
        >
          <option value="">Barcha tariflar</option>
          {tariffOptions.map((tariff) => (
            <option key={tariff.id} value={tariff.id}>
              {tariff.name}
            </option>
          ))}
        </select>

        <select
          value={subTariffId}
          onChange={(event) => setSubTariffId(event.target.value)}
          className={`${TOOLBAR_FIELD} xl:w-44`}
        >
          <option value="">Barcha subtariflar</option>
          {subTariffOptions.map((subTariff) => (
            <option key={subTariff.id} value={subTariff.id}>
              {subTariff.name}
            </option>
          ))}
        </select>
      </div>
    </FilterToolbar>
  );
}
