'use client';

import { IconCircleCheck, IconDownload, IconPencil, IconPlus, IconSearch, IconUsers, IconAlertCircle, IconX } from '@tabler/icons-react';
import type { DebtFilter } from '@dashboarduz/shared';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import type { CustomersPageModel } from './use-customers-page';

export function CustomersFilters({ vm }: { vm: CustomersPageModel }) {
  const { applySearch, bulkCourseId, bulkSubTariffId, bulkSubTariffOptions, bulkTariffId, bulkTariffOptions, clearSearch, courseId, courseOptions, customers, customersQuery, debtFilter, deleteCustomersMutation, editMode, editorCourses, filterSubTariffOptions, filterTariffOptions, handleBulkAssign, handleBulkDelete, handleDownloadFilteredCustomers, isAdmin, pageError, pageSuccess, resetAddModal, searchInput, selectedCount, setBulkCourseId, setBulkSubTariffId, setBulkTariffId, setCourseId, setDebtFilter, setEditMode, setIsAddModalOpen, setPageError, setPageSuccess, setSearchInput, setSubTariffId, setTariffId, subTariffId, tariffId, totalCustomersCount, updateCustomersCourseAssignmentMutation, withDebtCount, withoutDebtCount } = vm;

  return (
    <>
      <PageHeader
        title="Mijozlar"
        description={<>Kurs va qarzdorlik bo&apos;yicha filtrlangan mijozlar ro&apos;yxati.</>}
        actions={(
          <>
            <button
              type="button"
              onClick={handleDownloadFilteredCustomers}
              disabled={customersQuery.isLoading || customers.length === 0}
              className="btn btn-secondary"
            >
              <IconDownload className="h-4 w-4" stroke={1.8} />
              Filtrlangan ro&apos;yxatni yuklab olish
            </button>
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setPageError(null);
                    setPageSuccess(null);
                    setEditMode((prev) => !prev);
                  }}
                  aria-pressed={editMode}
                  className={`btn ${editMode ? 'btn-warning-soft' : 'btn-secondary'}`}
                >
                  {editMode ? <IconX className="h-4 w-4" stroke={1.8} /> : <IconPencil className="h-4 w-4" stroke={1.8} />}
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
                  className="btn btn-primary"
                >
                  <IconPlus className="h-4 w-4" stroke={2} />
                  Qo&apos;shish
                </button>
              </>
            )}
          </>
        )}
      />

      {pageError && <p className="alert alert-error">{pageError}</p>}
      {pageSuccess && <p className="alert alert-success">{pageSuccess}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Jami mijozlar" value={totalCustomersCount} icon={IconUsers} tone="blue" />
        <StatTile label="Qarzdor mijozlar" value={withDebtCount} icon={IconAlertCircle} tone="amber" />
        <StatTile label="Qarzsiz mijozlar" value={withoutDebtCount} icon={IconCircleCheck} tone="green" />
      </div>

      <div className="panel p-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              applySearch();
            }}
            className="flex min-w-0 flex-1 gap-2"
          >
            <div className="relative min-w-0 flex-1">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Raqam yoki ism bo'yicha qidirish"
                aria-label="Raqam yoki ism bo'yicha qidirish"
                className="field pl-9"
              />
            </div>
            <button type="submit" className="btn btn-primary">
              Qidirish
            </button>
            <button type="button" onClick={clearSearch} className="btn btn-ghost">
              Tozalash
            </button>
          </form>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:flex-none xl:gap-2">
            <select
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              aria-label="Kurs"
              className="field xl:w-48"
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
              aria-label="Tarif"
              className="field xl:w-44"
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
                aria-label="Subtarif"
                className="field xl:w-44"
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
              aria-label="Qarz holati"
              className="field xl:w-48"
            >
              <option value="all">Barcha qarz holatlari</option>
              <option value="with_debt">Qarzdorlar</option>
              <option value="without_debt">Qarzsizlar</option>
            </select>
          </div>
        </div>
      </div>

      {isAdmin && editMode && (
        <div className="panel animate-rise-in border-l-4 border-blue-500 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="lg:w-44">
              <p className="text-[13px] text-gray-500">Tanlangan mijozlar:</p>
              <p className="tabular text-2xl font-semibold text-gray-900">
                <strong>{selectedCount}</strong>
              </p>
            </div>

            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-3">
              <select
                value={bulkCourseId}
                onChange={(event) => setBulkCourseId(event.target.value)}
                aria-label="Kurs"
                className="field"
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
                aria-label="Tarif"
                className="field"
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
                aria-label="Subtarif"
                className="field"
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
                className="btn btn-primary"
              >
                {updateCustomersCourseAssignmentMutation.isLoading ? 'Saqlanmoqda...' : "Kursni o'zgartirish"}
              </button>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={selectedCount === 0 || deleteCustomersMutation.isLoading}
                className="btn btn-danger-soft"
              >
                {deleteCustomersMutation.isLoading ? "O'chirilmoqda..." : "Mijozlarni o'chirish"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
