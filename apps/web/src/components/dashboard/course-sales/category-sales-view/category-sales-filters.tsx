'use client';

import type { CategorySalesViewModel } from './use-category-sales-view';

export function CategorySalesFilters({ vm }: { vm: CategorySalesViewModel }) {
  const { applySearch, clearSearch, courseId, courses, searchInput, setCourseId, setSearchInput, setSubTariffId, setTariffId, subTariffId, subTariffOptions, tariffId, tariffOptions } = vm;

  return (
    <div className="rounded-lg bg-white p-5 shadow">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr_2fr]">
        <select
          value={courseId}
          onChange={(event) => {
            setCourseId(event.target.value);
            setTariffId('');
            setSubTariffId('');
          }}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
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
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
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
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
        >
          <option value="">Barcha subtariflar</option>
          {subTariffOptions.map((subTariff) => (
            <option key={subTariff.id} value={subTariff.id}>
              {subTariff.name}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
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
