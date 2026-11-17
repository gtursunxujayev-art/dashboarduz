'use client';

import { IconAlertCircle, IconChecks, IconCircleCheck, IconDownload, IconPencil, IconPlus, IconSearch, IconUsers, IconX } from '@tabler/icons-react';
import type { DebtFilter } from '@dashboarduz/shared';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { sharePercent } from '@/components/ui/split-bar';
import type { CustomersPageModel } from './use-customers-page';

const DEBT_FILTERS: Array<{ value: DebtFilter; label: string }> = [
  { value: 'all', label: 'Barcha qarz holatlari' },
  { value: 'with_debt', label: 'Qarzdorlar' },
  { value: 'without_debt', label: 'Qarzsizlar' },
];

/** Toolbar selects are pills; they keep the `field` colours and focus ring. */
const TOOLBAR_SELECT = 'field h-10 w-full rounded-full pl-4 pr-9 sm:w-auto sm:min-w-[11rem]';

export function CustomersFilters({ vm }: { vm: CustomersPageModel }) {
  const { applySearch, bulkCourseId, bulkSubTariffId, bulkSubTariffOptions, bulkTariffId, bulkTariffOptions, clearSearch, courseId, courseOptions, customers, customersQuery, debtFilter, deleteCustomersMutation, editMode, editorCourses, filterSubTariffOptions, filterTariffOptions, handleBulkAssign, handleBulkDelete, handleDownloadFilteredCustomers, isAdmin, pageError, pageSuccess, resetAddModal, searchInput, selectedCount, setBulkCourseId, setBulkSubTariffId, setBulkTariffId, setCourseId, setDebtFilter, setEditMode, setIsAddModalOpen, setPageError, setPageSuccess, setSearchInput, setSubTariffId, setTariffId, subTariffId, tariffId, totalCustomersCount, updateCustomersCourseAssignmentMutation, withDebtCount, withoutDebtCount } = vm;

  const hasTotal = Number(totalCustomersCount) > 0;

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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatTile label="Jami mijozlar" value={totalCustomersCount} icon={IconUsers} tone="blue" />
        <StatTile
          label="Qarzdor mijozlar"
          value={withDebtCount}
          icon={IconAlertCircle}
          tone="amber"
          hint={hasTotal ? <span className="tabular">{sharePercent(withDebtCount, totalCustomersCount)}</span> : undefined}
        />
        <StatTile
          label="Qarzsiz mijozlar"
          value={withoutDebtCount}
          icon={IconCircleCheck}
          tone="green"
          hint={hasTotal ? <span className="tabular">{sharePercent(withoutDebtCount, totalCustomersCount)}</span> : undefined}
        />
      </div>

      {/* One pill toolbar: search, course filters, debt status. */}
      <div className="panel flex flex-col gap-2.5 p-2.5 xl:flex-row xl:items-center">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            applySearch();
          }}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-nowrap"
        >
          <div className="relative min-w-0 flex-1 basis-full sm:basis-auto">
            <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Raqam yoki ism bo'yicha qidirish"
              aria-label="Raqam yoki ism bo'yicha qidirish"
              className="field rounded-full pl-10"
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Qidirish
          </button>
          <button type="button" onClick={clearSearch} className="btn btn-ghost">
            Tozalash
          </button>
        </form>

        <div className="flex min-w-0 flex-wrap items-center gap-2 xl:flex-nowrap">
          <select
            value={courseId}
            onChange={(event) => setCourseId(event.target.value)}
            aria-label="Kurs"
            className={TOOLBAR_SELECT}
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
            className={TOOLBAR_SELECT}
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
              className={TOOLBAR_SELECT}
            >
              <option value="">Barcha subtariflar</option>
              {filterSubTariffOptions.map((subTariff: any) => (
                <option key={subTariff.id} value={subTariff.id}>
                  {subTariff.name}
                </option>
              ))}
            </select>
          )}

          <div className="max-w-full overflow-x-auto">
            <div role="group" aria-label="Qarz holati" className="segmented bg-gray-50 shadow-none">
              {DEBT_FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDebtFilter(option.value)}
                  aria-pressed={debtFilter === option.value}
                  className={`segmented-item ${debtFilter === option.value ? 'segmented-item-active' : ''}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {isAdmin && editMode && (
        <div className="panel relative animate-rise-in overflow-hidden p-4 sm:p-5">
          <span aria-hidden="true" className="absolute inset-y-4 left-0 w-[3px] rounded-r-full bg-blue-600" />
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <div className="flex items-center gap-3 lg:w-52 lg:flex-none">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <IconChecks className="h-5 w-5" stroke={1.6} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] text-gray-500">Tanlangan mijozlar:</p>
                <p className="tabular text-xl font-semibold leading-tight text-gray-900">
                  <strong>{selectedCount}</strong>
                </p>
              </div>
            </div>

            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-3">
              <select
                value={bulkCourseId}
                onChange={(event) => setBulkCourseId(event.target.value)}
                aria-label="Kurs"
                className="field rounded-full pl-4"
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
                className="field rounded-full pl-4"
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
                className="field rounded-full pl-4"
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
