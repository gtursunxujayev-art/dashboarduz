'use client';

import LoadingBlock from '@/components/dashboard/loading-block';
import { formatSom, formatTashkentDate } from '@/lib/format';
import type { CourseSalesPageModel } from './use-course-sales-page';

export function CourseSalesResults({ vm }: { vm: CourseSalesPageModel }) {
  const { courseId, customers, customersQuery, exportFilteredList, isAdmin, isTashkiliyOnly, openCourseEditorModal, pagination, setPage, setSubTariffId, setTariffId, subTariffId, summary, summaryQuery, tariffId } = vm;

  return (
    <>
      {!courseId ? (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          Iltimos, avval kursni tanlang.
        </div>
      ) : (
        <>
          <div className={`grid grid-cols-1 gap-3 ${isTashkiliyOnly ? 'md:grid-cols-2 xl:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-4'}`}>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Jami mijozlar</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{summary?.currentCustomerCount ?? 0}</p>
            </div>

            {!isTashkiliyOnly && (
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-gray-500">Kelishuv summasi</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">
                  {formatSom(summary?.currentAgreementAmount ?? summary?.rangeAgreementAmount)}
                </p>
              </div>
            )}

            {!isTashkiliyOnly && (
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-gray-500">Tushum</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">
                  {formatSom(summary?.currentIncomeAmount ?? summary?.rangeIncomeAmount)}
                </p>
              </div>
            )}

            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Joriy qarz</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{formatSom(summary?.currentDebtAmount)}</p>
            </div>
          </div>

          <div className="rounded-lg bg-white p-4 shadow">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Tariflar taqsimoti</h2>
              <p className="text-xs text-gray-500">Tanlangan kurs bo&apos;yicha joriy mijozlar soni</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-8">
              {(summaryQuery.data?.tariffDistribution || []).map((item: any) => (
                <button
                  key={item.tariffId}
                  type="button"
                  onClick={() => setTariffId((current) => (current === item.tariffId ? '' : item.tariffId))}
                  className={`rounded-md border px-3 py-2 text-left transition ${
                    tariffId === item.tariffId || item.isSelected
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <p className="truncate text-xs text-gray-500">{item.tariffName}</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">{item.customerCount}</p>
                </button>
              ))}
            </div>
          </div>

          {tariffId && (summaryQuery.data?.subTariffDistribution?.length || 0) > 0 && (
            <div className="rounded-lg bg-white p-4 shadow">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Subtariflar taqsimoti</h2>
                <p className="text-xs text-gray-500">Tanlangan tarif bo&apos;yicha joriy mijozlar soni</p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-8">
                {(summaryQuery.data?.subTariffDistribution || []).map((item: any) => (
                  <button
                    key={item.subTariffId}
                    type="button"
                    onClick={() => setSubTariffId((current) => (current === item.subTariffId ? '' : item.subTariffId))}
                    className={`rounded-md border px-3 py-2 text-left transition ${
                      subTariffId === item.subTariffId || item.isSelected
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <p className="truncate text-xs text-gray-500">{item.subTariffName}</p>
                    <p className="mt-1 text-base font-semibold text-gray-900">{item.customerCount}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg bg-white p-5 shadow">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-900">Mijozlar ro&apos;yxati</h2>
              <button
                type="button"
                onClick={exportFilteredList}
                disabled={customers.length === 0}
                className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Filtrlangan ro&apos;yxatni yuklab olish
              </button>
            </div>

            {customersQuery.isLoading ? (
              <LoadingBlock message="Mijozlar yuklanmoqda..." />
            ) : customers.length === 0 ? (
              <p className="text-sm text-gray-600">Tanlangan filtrlar bo&apos;yicha mijoz topilmadi.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Mijoz raqami</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Ism</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Telegram</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Mas&apos;ul agent</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kurs / Tarif / Subtarif</th>
                      {!isTashkiliyOnly && (
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kelishuv</th>
                      )}
                      {!isTashkiliyOnly && (
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">To&apos;langan</th>
                      )}
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Qarz</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Oxirgi faollik</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {customers.map((row: any) => (
                      <tr key={row.saleId}>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{row.customerNumber}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{row.customerName}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.telegramUsername || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.managerLabel}</td>
                        <td className="px-3 py-2 text-sm text-gray-700">
                          <div className="space-y-1">
                            {(Array.isArray(row.customerCourses) && row.customerCourses.length ? row.customerCourses : [{
                              saleIncomeId: row.saleId,
                              label: [row.courseName, row.tariffName, row.subTariffName].filter(Boolean).join(' / ') || '-',
                            }]).map((entry: any) => (
                              <div key={entry.saleIncomeId} className="flex items-center gap-2">
                                <span className="truncate">{entry.label}</span>
                              </div>
                            ))}
                            {isAdmin && (
                              <div className="pt-1">
                                <button
                                  type="button"
                                  onClick={() => openCourseEditorModal(row.customerId)}
                                  className="rounded border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                                >
                                  Tahrirlash
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                        {!isTashkiliyOnly && (
                          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatSom(row.agreementAmount)}</td>
                        )}
                        {!isTashkiliyOnly && (
                          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatSom(row.paidAmount)}</td>
                        )}
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatSom(row.debtAmount)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatTashkentDate(row.lastActivityAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-600">Jami: {pagination.total}</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={pagination.page <= 1}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Oldingi
                </button>
                <span className="text-sm text-gray-600">
                  {pagination.page} / {pagination.totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
                  disabled={pagination.page >= pagination.totalPages}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Keyingi
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
