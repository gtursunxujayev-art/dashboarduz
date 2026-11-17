'use client';

import { IconSearch } from '@tabler/icons-react';
import type { CategorySalesViewModel } from './use-category-sales-view';

export function CategorySalesFilters({ vm }: { vm: CategorySalesViewModel }) {
  const { applySearch, clearSearch, courseId, courses, searchInput, setCourseId, setSearchInput, setSubTariffId, setTariffId, subTariffId, subTariffOptions, tariffId, tariffOptions } = vm;

  return (
    <div className="panel p-3 sm:p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
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

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:flex xl:flex-none">
          <select
            value={courseId}
            onChange={(event) => {
              setCourseId(event.target.value);
              setTariffId('');
              setSubTariffId('');
            }}
            className="field xl:w-52"
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
            className="field xl:w-44"
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
            className="field xl:w-44"
          >
            <option value="">Barcha subtariflar</option>
            {subTariffOptions.map((subTariff) => (
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
