'use client';

import { IconChevronLeft, IconChevronRight, IconDownload, IconPencil, IconSearch, IconUsers } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatSom, formatTashkentDate } from '@/lib/format';
import type { CourseDetailPageModel } from './use-course-detail-page';

export function CourseDetailCustomers({ vm }: { vm: CourseDetailPageModel }) {
  const { applySearch, clearSearch, customers, customersQuery, exportCustomers, isAdmin, isTashkiliyOnly, openCourseEditorModal, pagination, searchInput, setPage, setSearchInput, tab } = vm;

  return (
    <>
      {tab === 'mijozlar' && (
        <div className="panel">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <h2 className="section-title">Mijozlar</h2>
              <span className="badge badge-neutral tabular">{pagination.total}</span>
            </div>
            <button
              type="button"
              onClick={exportCustomers}
              disabled={customers.length === 0}
              className="btn btn-secondary btn-sm"
            >
              <IconDownload className="h-4 w-4" stroke={1.8} />
              Yuklab olish
            </button>
          </div>

          <div className="px-5 pt-4 sm:px-6">
            <div className="flex flex-wrap gap-2 sm:flex-nowrap">
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
          </div>

          <div className="p-2 sm:p-3">
            {customersQuery.isLoading ? (
              <LoadingBlock message="Mijozlar yuklanmoqda..." />
            ) : customers.length === 0 ? (
              <EmptyState icon={IconUsers} title="Tanlangan filtr bo'yicha mijoz topilmadi." />
            ) : (
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
                      <tr key={row.saleId}>
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
                          <div className="flex min-w-[200px] flex-col items-start gap-1">
                            {(Array.isArray(row.customerCourses) && row.customerCourses.length ? row.customerCourses : [{
                              saleIncomeId: row.saleId,
                              label: [row.courseName, row.tariffName, row.subTariffName].filter(Boolean).join(' / ') || '-',
                            }]).map((entry: any) => (
                              <div key={entry.saleIncomeId} className="flex max-w-full items-center gap-2">
                                <span className="badge badge-neutral max-w-full truncate">{entry.label}</span>
                              </div>
                            ))}
                            {isAdmin && (
                              <div className="pt-1">
                                <button
                                  type="button"
                                  onClick={() => openCourseEditorModal(row.customerId)}
                                  className="btn btn-soft btn-sm"
                                >
                                  <IconPencil className="h-3.5 w-3.5" stroke={1.8} />
                                  Tahrirlash
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                        {!isTashkiliyOnly && <td className="tabular whitespace-nowrap text-right">{formatSom(row.agreementAmount)}</td>}
                        {!isTashkiliyOnly && <td className="tabular whitespace-nowrap text-right text-emerald-700">{formatSom(row.paidAmount)}</td>}
                        <td className="tabular whitespace-nowrap text-right font-medium text-gray-900">{formatSom(row.debtAmount)}</td>
                        <td className="tabular whitespace-nowrap text-gray-500">{formatTashkentDate(row.lastActivityAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-5 py-3 sm:px-6">
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
              <span className="tabular text-sm text-gray-600">
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
        </div>
      )}
    </>
  );
}
