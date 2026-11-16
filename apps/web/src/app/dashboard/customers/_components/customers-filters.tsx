'use client';

import type { DebtFilter } from '@dashboarduz/shared';
import type { CustomersPageModel } from './use-customers-page';

export function CustomersFilters({ vm }: { vm: CustomersPageModel }) {
  const { applySearch, bulkCourseId, bulkSubTariffId, bulkSubTariffOptions, bulkTariffId, bulkTariffOptions, clearSearch, courseId, courseOptions, customers, customersQuery, debtFilter, deleteCustomersMutation, editMode, editorCourses, filterSubTariffOptions, filterTariffOptions, handleBulkAssign, handleBulkDelete, handleDownloadFilteredCustomers, isAdmin, pageError, pageSuccess, resetAddModal, searchInput, selectedCount, setBulkCourseId, setBulkSubTariffId, setBulkTariffId, setCourseId, setDebtFilter, setEditMode, setIsAddModalOpen, setPageError, setPageSuccess, setSearchInput, setSubTariffId, setTariffId, subTariffId, tariffId, totalCustomersCount, updateCustomersCourseAssignmentMutation, withDebtCount, withoutDebtCount } = vm;

  return (
    <div className="rounded-lg bg-white shadow dark:bg-slate-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Mijozlar</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            Kurs va qarzdorlik bo&apos;yicha filtrlangan mijozlar ro&apos;yxati.
          </p>
        </div>

        <div className="space-y-4 p-6">
          {pageError && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
              {pageError}
            </p>
          )}
          {pageSuccess && (
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">
              {pageSuccess}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                applySearch();
              }}
              className="flex gap-2 md:col-span-2"
            >
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Raqam yoki ism bo'yicha qidirish"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="submit"
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Qidirish
              </button>
              <button
                type="button"
                onClick={clearSearch}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Tozalash
              </button>
            </form>

            <select
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">Barcha kurslar</option>
              {courseOptions.map((course: any) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>

            <select
              value={tariffId}
              onChange={(event) => setTariffId(event.target.value)}
              disabled={!courseId}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
            >
              <option value="">Barcha tariflar</option>
              {filterTariffOptions.map((tariff: any) => (
                <option key={tariff.id} value={tariff.id}>
                  {tariff.name}
                </option>
              ))}
            </select>

            {filterSubTariffOptions.length > 0 && (
              <select
                value={subTariffId}
                onChange={(event) => setSubTariffId(event.target.value)}
                disabled={!tariffId}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
              >
                <option value="">Barcha subtariflar</option>
                {filterSubTariffOptions.map((subTariff: any) => (
                  <option key={subTariff.id} value={subTariff.id}>
                    {subTariff.name}
                  </option>
                ))}
              </select>
            )}

            <select
              value={debtFilter}
              onChange={(event) => setDebtFilter(event.target.value as DebtFilter)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="all">Barcha qarz holatlari</option>
              <option value="with_debt">Qarzdorlar</option>
              <option value="without_debt">Qarzsizlar</option>
            </select>
          </div>

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPageError(null);
                  setPageSuccess(null);
                  setEditMode((prev) => !prev);
                }}
                className={`rounded-md px-3 py-2 text-sm font-medium ${
                  editMode
                    ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {editMode ? 'Tahrirlashni yopish' : "O'zgartirish"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPageError(null);
                  setPageSuccess(null);
                  resetAddModal();
                  setIsAddModalOpen(true);
                }}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Qo&apos;shish
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadFilteredCustomers}
              disabled={customersQuery.isLoading || customers.length === 0}
              className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40"
            >
              Filtrlangan ro&apos;yxatni yuklab olish
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs uppercase text-gray-500 dark:text-slate-400">Jami mijozlar</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-slate-100">{totalCustomersCount}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs uppercase text-gray-500 dark:text-slate-400">Qarzdor mijozlar</p>
              <p className="text-lg font-semibold text-amber-700 dark:text-amber-300">{withDebtCount}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs uppercase text-gray-500 dark:text-slate-400">Qarzsiz mijozlar</p>
              <p className="text-lg font-semibold text-green-700 dark:text-green-300">{withoutDebtCount}</p>
            </div>
          </div>

          {isAdmin && editMode && (
            <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/20">
              <div className="text-sm text-blue-900 dark:text-blue-200">
                Tanlangan mijozlar: <strong>{selectedCount}</strong>
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <select
                  value={bulkCourseId}
                  onChange={(event) => setBulkCourseId(event.target.value)}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">Kursni tozalash</option>
                  {editorCourses.map((course: any) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </select>

                <select
                  value={bulkTariffId}
                  onChange={(event) => setBulkTariffId(event.target.value)}
                  disabled={!bulkCourseId}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                >
                  <option value="">Tarifni tozalash</option>
                  {bulkTariffOptions.map((tariff: any) => (
                    <option key={tariff.id} value={tariff.id}>
                      {tariff.name}
                    </option>
                  ))}
                </select>

                <select
                  value={bulkSubTariffId}
                  onChange={(event) => setBulkSubTariffId(event.target.value)}
                  disabled={!bulkTariffId || bulkSubTariffOptions.length === 0}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                >
                  <option value="">Subtarifni tozalash</option>
                  {bulkSubTariffOptions.map((subTariff: any) => (
                    <option key={subTariff.id} value={subTariff.id}>
                      {subTariff.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleBulkAssign}
                  disabled={selectedCount === 0 || updateCustomersCourseAssignmentMutation.isLoading}
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {updateCustomersCourseAssignmentMutation.isLoading ? 'Saqlanmoqda...' : "Kursni o'zgartirish"}
                </button>
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  disabled={selectedCount === 0 || deleteCustomersMutation.isLoading}
                  className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteCustomersMutation.isLoading ? "O'chirilmoqda..." : "Mijozlarni o'chirish"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
  );
}
