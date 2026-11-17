'use client';

import {
  IconAlertCircle,
  IconCash,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconFileText,
  IconPencil,
  IconSchool,
  IconUsers,
} from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatSom, formatTashkentDate } from '@/lib/format';
import type { CourseSalesPageModel } from './use-course-sales-page';

function chipClass(active: boolean) {
  return `rounded-[10px] px-3 py-2.5 text-left ring-1 transition active:scale-[0.98] ${
    active
      ? 'bg-blue-50 ring-blue-500'
      : 'bg-white ring-gray-200 hover:bg-gray-50 hover:ring-gray-300'
  }`;
}

export function CourseSalesResults({ vm }: { vm: CourseSalesPageModel }) {
  const { courseId, customers, customersQuery, exportFilteredList, isAdmin, isTashkiliyOnly, openCourseEditorModal, pagination, setPage, setSubTariffId, setTariffId, subTariffId, summary, summaryQuery, tariffId } = vm;

  return (
    <>
      {!courseId ? (
        <div className="panel p-3 sm:p-4">
          <EmptyState icon={IconSchool} title="Iltimos, avval kursni tanlang." />
        </div>
      ) : (
        <>
          <div className={`grid grid-cols-1 gap-4 ${isTashkiliyOnly ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-4'}`}>
            <StatTile label="Jami mijozlar" value={summary?.currentCustomerCount ?? 0} icon={IconUsers} tone="blue" />

            {!isTashkiliyOnly && (
              <StatTile
                label="Kelishuv summasi"
                value={formatSom(summary?.currentAgreementAmount ?? summary?.rangeAgreementAmount)}
                icon={IconFileText}
              />
            )}

            {!isTashkiliyOnly && (
              <StatTile
                label="Tushum"
                value={formatSom(summary?.currentIncomeAmount ?? summary?.rangeIncomeAmount)}
                icon={IconCash}
                tone="green"
              />
            )}

            <StatTile label="Joriy qarz" value={formatSom(summary?.currentDebtAmount)} icon={IconAlertCircle} tone="amber" />
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2 className="section-title">Tariflar taqsimoti</h2>
              <p className="text-xs text-gray-500">Tanlangan kurs bo&apos;yicha joriy mijozlar soni</p>
            </div>
            <div className="panel-body grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-8">
              {(summaryQuery.data?.tariffDistribution || []).map((item: any) => {
                const active = tariffId === item.tariffId || item.isSelected;
                return (
                  <button
                    key={item.tariffId}
                    type="button"
                    onClick={() => setTariffId((current) => (current === item.tariffId ? '' : item.tariffId))}
                    aria-pressed={Boolean(active)}
                    className={chipClass(Boolean(active))}
                  >
                    <p className={`truncate text-xs ${active ? 'text-blue-700' : 'text-gray-500'}`}>{item.tariffName}</p>
                    <p className="tabular mt-1 text-base font-semibold text-gray-900">{item.customerCount}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {tariffId && (summaryQuery.data?.subTariffDistribution?.length || 0) > 0 && (
            <div className="panel animate-rise-in">
              <div className="panel-header">
                <h2 className="section-title">Subtariflar taqsimoti</h2>
                <p className="text-xs text-gray-500">Tanlangan tarif bo&apos;yicha joriy mijozlar soni</p>
              </div>
              <div className="panel-body grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-8">
                {(summaryQuery.data?.subTariffDistribution || []).map((item: any) => {
                  const active = subTariffId === item.subTariffId || item.isSelected;
                  return (
                    <button
                      key={item.subTariffId}
                      type="button"
                      onClick={() => setSubTariffId((current) => (current === item.subTariffId ? '' : item.subTariffId))}
                      aria-pressed={Boolean(active)}
                      className={chipClass(Boolean(active))}
                    >
                      <p className={`truncate text-xs ${active ? 'text-blue-700' : 'text-gray-500'}`}>{item.subTariffName}</p>
                      <p className="tabular mt-1 text-base font-semibold text-gray-900">{item.customerCount}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <h2 className="section-title">Mijozlar ro&apos;yxati</h2>
                <span className="badge badge-neutral tabular">{pagination.total}</span>
              </div>
              <button
                type="button"
                onClick={exportFilteredList}
                disabled={customers.length === 0}
                className="btn btn-secondary btn-sm"
              >
                <IconDownload className="h-4 w-4" stroke={1.8} />
                Filtrlangan ro&apos;yxatni yuklab olish
              </button>
            </div>

            <div className="p-2 sm:p-3">
              {customersQuery.isLoading ? (
                <LoadingBlock message="Mijozlar yuklanmoqda..." />
              ) : customers.length === 0 ? (
                <EmptyState icon={IconUsers} title="Tanlangan filtrlar bo'yicha mijoz topilmadi." />
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
                        {!isTashkiliyOnly && (
                          <th className="text-right">Kelishuv</th>
                        )}
                        {!isTashkiliyOnly && (
                          <th className="text-right">To&apos;langan</th>
                        )}
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
                          {!isTashkiliyOnly && (
                            <td className="tabular whitespace-nowrap text-right">{formatSom(row.agreementAmount)}</td>
                          )}
                          {!isTashkiliyOnly && (
                            <td className="tabular whitespace-nowrap text-right text-emerald-700">{formatSom(row.paidAmount)}</td>
                          )}
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
        </>
      )}
    </>
  );
}
