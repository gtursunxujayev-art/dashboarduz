'use client';

import { useId, type ReactNode } from 'react';
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconPencil,
  IconSchool,
  IconSearch,
  IconTrash,
  IconUsers,
  IconX,
} from '@tabler/icons-react';
import type { ReportRangePreset as DashboardRange } from '@dashboarduz/shared';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatSom, formatTashkentDate } from '@/lib/format';

/*
 * Shared presentational pieces of the course sales screens (main page, course detail and the
 * Intensiv / Online / Oflayn views). They only render what the page hooks hand them.
 */

/** Toolbar pill select / input: the `field` shape, rounded into a pill for the filter row. */
export const TOOLBAR_FIELD = 'field rounded-full';

/** The one filter row of a page: a single surface holding pill controls that wrap on narrow screens. */
export function FilterToolbar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`panel flex flex-wrap items-center gap-2 p-2.5 ${className}`}>
      {children}
    </div>
  );
}

/** Thin vertical divider between groups of a toolbar (hidden when the toolbar wraps on small screens). */
export function ToolbarDivider() {
  return <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-gray-200 xl:block" />;
}

const RANGE_OPTIONS: Array<{ value: DashboardRange; label: string }> = [
  { value: 'today', label: 'Bugun' },
  { value: 'week', label: 'Hafta' },
  { value: 'month', label: 'Oy' },
  { value: 'custom', label: 'Ixtiyoriy' },
];

/** Segmented period presets plus the custom date pair (enabled only for "Ixtiyoriy"). */
export function PeriodControls({
  range,
  setRange,
  dateFrom,
  dateTo,
  setDateFrom,
  setDateTo,
}: {
  range: DashboardRange;
  setRange: (value: DashboardRange) => void;
  dateFrom: string;
  dateTo: string;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
}) {
  return (
    <>
      <div className="segmented max-w-full overflow-x-auto">
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

      <div className="flex min-w-0 items-center gap-1.5">
        <IconCalendar className="ml-1 hidden h-4 w-4 flex-shrink-0 text-gray-400 sm:block" stroke={1.8} />
        <input
          type="date"
          value={dateFrom}
          disabled={range !== 'custom'}
          onChange={(event) => setDateFrom(event.target.value)}
          className={`${TOOLBAR_FIELD} min-w-0 sm:w-[150px]`}
        />
        <input
          type="date"
          value={dateTo}
          disabled={range !== 'custom'}
          onChange={(event) => setDateTo(event.target.value)}
          className={`${TOOLBAR_FIELD} min-w-0 sm:w-[150px]`}
        />
      </div>
    </>
  );
}

/** Customer search: pill input with "Qidirish" and "Tozalash". */
export function SearchControls({
  searchInput,
  setSearchInput,
  applySearch,
  clearSearch,
  className = '',
}: {
  searchInput: string;
  setSearchInput: (value: string) => void;
  applySearch: () => void;
  clearSearch: () => void;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap ${className}`}>
      <div className="relative min-w-0 flex-1 basis-full sm:basis-auto">
        <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
        <input
          type="text"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Mijoz raqami yoki ism"
          className={`${TOOLBAR_FIELD} pl-10`}
        />
      </div>
      <button type="button" onClick={applySearch} className="btn btn-primary">
        Qidirish
      </button>
      <button type="button" onClick={clearSearch} className="btn btn-ghost">
        Tozalash
      </button>
    </div>
  );
}

type Pagination = { page: number; totalPages: number; total: number };
type PageSetter = (updater: (current: number) => number) => void;

/** Panel around a customer table: title + count + export on top, pagination at the bottom. */
export function CustomersPanel({
  title,
  exportLabel,
  onExport,
  exportDisabled,
  toolbar,
  isLoading,
  isEmpty,
  emptyTitle,
  pagination,
  setPage,
  children,
}: {
  title: ReactNode;
  exportLabel: ReactNode;
  onExport: () => void;
  exportDisabled: boolean;
  toolbar?: ReactNode;
  isLoading: boolean;
  isEmpty: boolean;
  emptyTitle: ReactNode;
  pagination: Pagination;
  setPage: PageSetter;
  children: ReactNode;
}) {
  return (
    <section className="panel flex min-w-0 flex-col">
      <div className="panel-header">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <IconUsers className="h-[18px] w-[18px]" stroke={1.6} />
          </span>
          <h2 className="section-title">{title}</h2>
          <span className="badge badge-neutral tabular">{pagination.total}</span>
        </div>
        <button
          type="button"
          onClick={onExport}
          disabled={exportDisabled}
          className="btn btn-secondary btn-sm"
        >
          <IconDownload className="h-4 w-4" stroke={1.8} />
          {exportLabel}
        </button>
      </div>

      {toolbar ? <div className="px-5 pt-4 sm:px-6">{toolbar}</div> : null}

      <div className="px-2 pb-2 pt-3 sm:px-3">
        {isLoading ? (
          <LoadingBlock message="Mijozlar yuklanmoqda..." className="min-h-[220px]" />
        ) : isEmpty ? (
          <EmptyState icon={IconUsers} title={emptyTitle} />
        ) : (
          children
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-5 py-3 sm:px-6">
        <p className="tabular text-sm text-gray-500">Jami: {pagination.total}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={pagination.page <= 1}
            className="btn btn-secondary btn-sm"
          >
            <IconChevronLeft className="h-4 w-4" stroke={1.8} />
            Oldingi
          </button>
          <span className="tabular rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
            {pagination.page} / {pagination.totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
            disabled={pagination.page >= pagination.totalPages}
            className="btn btn-secondary btn-sm"
          >
            Keyingi
            <IconChevronRight className="h-4 w-4" stroke={1.8} />
          </button>
        </div>
      </div>
    </section>
  );
}

function customerCourseEntries(row: any): any[] {
  return Array.isArray(row.customerCourses) && row.customerCourses.length
    ? row.customerCourses
    : [{
        saleIncomeId: row.saleId,
        label: [row.courseName, row.tariffName, row.subTariffName].filter(Boolean).join(' / ') || '-',
      }];
}

/** Customer rows of a course sales screen. Money columns are hidden for Tashkiliy-only users. */
export function CourseCustomersTable({
  customers,
  isAdmin,
  isTashkiliyOnly,
  onEdit,
}: {
  customers: any[];
  isAdmin: boolean;
  isTashkiliyOnly: boolean;
  onEdit: (customerId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th className="text-left">Mijoz raqami</th>
            <th className="text-left">Ism</th>
            <th className="text-left">Telegram</th>
            <th className="text-left">Mas&apos;ul agent</th>
            <th className="text-left">Kurs / Tarif / Subtarif</th>
            {!isTashkiliyOnly && <th className="text-right">Kelishuv</th>}
            {!isTashkiliyOnly && <th className="text-right">To&apos;langan</th>}
            <th className="text-right">Qarz</th>
            <th className="text-left">Oxirgi faollik</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((row: any) => (
            <tr key={row.saleId} className="transition-colors hover:bg-gray-50">
              <td className="tabular whitespace-nowrap text-gray-500">{row.customerNumber}</td>
              <td className="whitespace-nowrap">
                <div className="flex items-center gap-2.5">
                  <UserAvatar name={String(row.customerName || '?')} size="sm" />
                  <span className="font-medium text-gray-900">{row.customerName}</span>
                </div>
              </td>
              <td className="whitespace-nowrap text-gray-500">{row.telegramUsername || '-'}</td>
              <td className="whitespace-nowrap">{row.managerLabel}</td>
              <td>
                <div className="flex min-w-[220px] flex-wrap items-center gap-1.5">
                  {customerCourseEntries(row).map((entry: any) => (
                    <span key={entry.saleIncomeId} className="badge badge-blue max-w-full">
                      <IconSchool className="h-3.5 w-3.5 flex-shrink-0" stroke={1.8} />
                      <span className="truncate">{entry.label}</span>
                    </span>
                  ))}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => onEdit(row.customerId)}
                      className="btn btn-ghost btn-sm"
                    >
                      <IconPencil className="h-3.5 w-3.5" stroke={1.8} />
                      Tahrirlash
                    </button>
                  )}
                </div>
              </td>
              {!isTashkiliyOnly && (
                <td className="tabular whitespace-nowrap text-right">{formatSom(row.agreementAmount)}</td>
              )}
              {!isTashkiliyOnly && (
                <td className="tabular whitespace-nowrap text-right text-emerald-700">{formatSom(row.paidAmount)}</td>
              )}
              <td className="tabular whitespace-nowrap text-right font-semibold text-gray-900">{formatSom(row.debtAmount)}</td>
              <td className="tabular whitespace-nowrap text-gray-500">{formatTashkentDate(row.lastActivityAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The fields every course sales page model exposes for the customer course editor. */
export type CustomerCourseEditorModel = {
  actionError: string | null;
  actionSuccess: string | null;
  closeCourseEditorModal: () => void;
  courseEditCourseId: string;
  courseEditSubTariffId: string;
  courseEditTariffId: string;
  courseEditorCustomer: any;
  deletingCourseSaleId: string;
  editSubTariffOptions: any[];
  editTariffOptions: any[];
  editingSaleIncomeId: string;
  editorCourses: any[];
  handleDeleteCustomerCourse: (entry: any, allEntries: any[]) => unknown;
  handleSaveCourseChange: () => unknown;
  isAdmin: boolean;
  isCourseEditorModalOpen: boolean;
  setCourseEditCourseId: (value: string) => void;
  setCourseEditSubTariffId: (value: string) => void;
  setCourseEditTariffId: (value: string) => void;
  setEditingSaleIncomeId: (value: string) => void;
  startCourseChange: (entry: any) => void;
  updateCustomerCourseSaleMutation: { isLoading: boolean };
};

/** True while the customer course sheet is on screen (the page then shows its messages inside it). */
export function isCustomerCourseSheetOpen(vm: Pick<CustomerCourseEditorModel, 'isAdmin' | 'isCourseEditorModalOpen' | 'courseEditorCustomer'>) {
  return Boolean(vm.isAdmin && vm.isCourseEditorModalOpen && vm.courseEditorCustomer);
}

/** Page-level action messages. */
export function ActionMessages({ actionError, actionSuccess }: { actionError: string | null; actionSuccess: string | null }) {
  return (
    <>
      {actionError && <div className="alert alert-error">{actionError}</div>}
      {actionSuccess && <div className="alert alert-success">{actionSuccess}</div>}
    </>
  );
}

/** Right sheet listing a customer's courses, with change and delete actions per course. */
export function CustomerCoursesSheet({ vm }: { vm: CustomerCourseEditorModel }) {
  const { actionError, actionSuccess, closeCourseEditorModal, courseEditCourseId, courseEditSubTariffId, courseEditTariffId, courseEditorCustomer, deletingCourseSaleId, editSubTariffOptions, editTariffOptions, editingSaleIncomeId, editorCourses, handleDeleteCustomerCourse, handleSaveCourseChange, setCourseEditCourseId, setCourseEditSubTariffId, setCourseEditTariffId, setEditingSaleIncomeId, startCourseChange, updateCustomerCourseSaleMutation } = vm;
  const fieldId = useId();

  if (!isCustomerCourseSheetOpen(vm)) {
    return null;
  }

  const entries: any[] = Array.isArray(courseEditorCustomer.customerCourses) && courseEditorCustomer.customerCourses.length
    ? courseEditorCustomer.customerCourses
    : [{
        saleIncomeId: courseEditorCustomer.saleId,
        label: [courseEditorCustomer.courseName, courseEditorCustomer.tariffName, courseEditorCustomer.subTariffName]
          .filter(Boolean)
          .join(' / ') || '-',
        entryDate: courseEditorCustomer.entryDate,
        remainingDebtAmount: courseEditorCustomer.debtAmount || 0,
      }];
  const isEditingListed = Boolean(editingSaleIncomeId) && entries.some((entry) => entry.saleIncomeId === editingSaleIncomeId);
  const cancelEditing = () => {
    setEditingSaleIncomeId('');
    setCourseEditCourseId('');
    setCourseEditTariffId('');
    setCourseEditSubTariffId('');
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-panel max-w-[600px]" role="dialog" aria-modal="true" aria-labelledby={`${fieldId}-title`}>
        <div className="modal-header">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <UserAvatar name={String(courseEditorCustomer.customerName || '?')} />
              <div className="min-w-0">
                <h2 id={`${fieldId}-title`} className="modal-title">Mijoz kurslarini tahrirlash</h2>
                <p className="modal-description tabular mt-0.5 truncate">
                  {courseEditorCustomer.customerNumber} - {courseEditorCustomer.customerName}
                </p>
              </div>
            </div>
            <button type="button" onClick={closeCourseEditorModal} className="btn btn-ghost btn-sm">
              <IconX className="h-4 w-4" stroke={1.8} />
              Yopish
            </button>
          </div>
        </div>

        <div className="modal-body">
          <ActionMessages actionError={actionError} actionSuccess={actionSuccess} />

          {entries.map((entry: any) => {
            const isEditing = editingSaleIncomeId === entry.saleIncomeId;
            return (
              <div
                key={entry.saleIncomeId}
                className={`rounded-[16px] p-4 ring-1 transition ${
                  isEditing ? 'bg-white shadow-sm ring-blue-300' : 'bg-gray-50 ring-transparent'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                    <IconSchool className="h-[18px] w-[18px]" stroke={1.6} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900">{entry.label}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                      <IconCalendar className="h-3.5 w-3.5 flex-shrink-0" stroke={1.8} />
                      <span className="tabular">
                        Sana: {formatTashkentDate(entry.entryDate)} | Joriy qarz: {formatSom(entry.remainingDebtAmount || 0)}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
                  <button type="button" onClick={() => startCourseChange(entry)} className="btn btn-soft btn-sm">
                    <IconPencil className="h-3.5 w-3.5" stroke={1.8} />
                    Kursni o&apos;zgartirish
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCustomerCourse(entry, courseEditorCustomer.customerCourses || [])}
                    disabled={deletingCourseSaleId === entry.saleIncomeId}
                    className="btn btn-danger-soft btn-sm"
                  >
                    <IconTrash className="h-3.5 w-3.5" stroke={1.8} />
                    {deletingCourseSaleId === entry.saleIncomeId ? "O'chirilmoqda..." : "Kursni o'chirish"}
                  </button>
                </div>

                {isEditing && (
                  <div className="mt-4 animate-rise-in space-y-3 border-t border-gray-100 pt-4">
                    <div>
                      <label htmlFor={`${fieldId}-course`} className="field-label">Yangi kurs</label>
                      <select
                        id={`${fieldId}-course`}
                        value={courseEditCourseId}
                        onChange={(event) => setCourseEditCourseId(event.target.value)}
                        className="field"
                      >
                        <option value="">Kurs tanlang</option>
                        {editorCourses.map((course: any) => (
                          <option key={course.id} value={course.id}>
                            {course.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`${fieldId}-tariff`} className="field-label">Yangi tarif</label>
                        <select
                          id={`${fieldId}-tariff`}
                          value={courseEditTariffId}
                          onChange={(event) => setCourseEditTariffId(event.target.value)}
                          disabled={!courseEditCourseId}
                          className="field"
                        >
                          <option value="">Tarif tanlanmagan</option>
                          {editTariffOptions.map((tariff: any) => (
                            <option key={tariff.id} value={tariff.id}>
                              {tariff.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`${fieldId}-subtariff`} className="field-label">Yangi subtarif</label>
                        <select
                          id={`${fieldId}-subtariff`}
                          value={courseEditSubTariffId}
                          onChange={(event) => setCourseEditSubTariffId(event.target.value)}
                          disabled={!courseEditTariffId || !editSubTariffOptions.length}
                          className="field"
                        >
                          <option value="">Subtarif tanlanmagan</option>
                          {editSubTariffOptions.map((subTariff: any) => (
                            <option key={subTariff.id} value={subTariff.id}>
                              {subTariff.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {isEditingListed && (
          <div className="modal-footer">
            <button type="button" onClick={cancelEditing} className="btn btn-secondary">
              Bekor qilish
            </button>
            <button
              type="button"
              onClick={handleSaveCourseChange}
              disabled={updateCustomerCourseSaleMutation.isLoading}
              className="btn btn-primary"
            >
              {updateCustomerCourseSaleMutation.isLoading ? 'Saqlanmoqda...' : "O'zgarishni saqlash"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
