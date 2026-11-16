'use client';

import LoadingBlock from '@/components/dashboard/loading-block';
import { formatSom, formatTashkentDate } from '@/lib/format';
import type { CategorySalesViewModel } from './use-category-sales-view';

export function CategorySalesCustomers({ vm }: { vm: CategorySalesViewModel }) {
  const { customers, customersQuery, exportFilteredList, isAdmin, isTashkiliyOnly, openCourseEditorModal, pagination, setPage } = vm;

  return (
    <div className="rounded-lg bg-white p-5 shadow">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Mijozlar ro'yxati</h2>
        <button
          type="button"
          onClick={exportFilteredList}
          disabled={customers.length === 0}
          className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Filtrlangan ro'yxatni yuklab olish
        </button>
      </div>

      {customersQuery.isLoading ? (
        <LoadingBlock message="Mijozlar yuklanmoqda..." />
      ) : customers.length === 0 ? (
        <p className="text-sm text-gray-600">Tanlangan filtrlar bo'yicha mijoz topilmadi.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Mijoz raqami</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Ism</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Telegram</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Mas'ul agent</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kurs / Tarif / Subtarif</th>
                {!isTashkiliyOnly && (
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kelishuv</th>
                )}
                {!isTashkiliyOnly && (
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">To'langan</th>
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
  );
}
