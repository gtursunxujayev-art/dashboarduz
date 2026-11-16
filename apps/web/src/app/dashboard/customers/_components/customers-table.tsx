'use client';

import LoadingBlock from '@/components/dashboard/loading-block';
import { formatNumberEn, formatTashkentDate } from '@/lib/format';
import type { CustomersPageModel } from './use-customers-page';

export function CustomersTable({ vm }: { vm: CustomersPageModel }) {
  const { customers, customersQuery, editMode, handleToggleCustomer, handleToggleSelectAll, isAdmin, isAllSelected, isTashkiliyOnly, openCourseEditorModal, openDetailsModal, openIdentityModal, selectedCustomerIds } = vm;

  return (
    <div className="rounded-lg bg-white shadow dark:bg-slate-900">
      <div className="px-6 py-5">
        {customersQuery.isLoading ? (
          <LoadingBlock message="Mijozlar yuklanmoqda..." />
        ) : customersQuery.error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
            {customersQuery.error.message || "Mijozlarni yuklab bo'lmadi."}
          </p>
        ) : customers.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
              <thead className="bg-gray-50 dark:bg-slate-800">
                <tr>
                  {isAdmin && editMode && (
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={handleToggleSelectAll}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Mijoz raqami</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Mijoz ismi</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Telegram</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Mas&apos;ul agent</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Kurslar</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Qarz</th>
                  {!isTashkiliyOnly && (
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Jami to&apos;langan</th>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Oxirgi faollik</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Batafsil</th>
                  {isAdmin && editMode && (
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Amal</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
                {customers.map((customer: any) => (
                  <tr key={customer.id}>
                    {isAdmin && editMode && (
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedCustomerIds.includes(customer.id)}
                          onChange={() => handleToggleCustomer(customer.id)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600"
                        />
                      </td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900 dark:text-slate-100">{customer.customerNumber}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{customer.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{customer.telegramUsername || '-'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{customer.responsibleManagerLabel || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                      {Array.isArray(customer.courseEntries) && customer.courseEntries.length ? (
                        <div className="space-y-1">
                          {customer.courseEntries.map((entry: any) => (
                            <div key={entry.saleIncomeId} className="flex items-center gap-2">
                              <span className="truncate">{entry.label}</span>
                            </div>
                          ))}
                          {isAdmin && editMode && (
                            <div className="pt-1">
                              <button
                                type="button"
                                onClick={() => openCourseEditorModal(customer.id)}
                                className="rounded border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
                              >
                                Tahrirlash
                              </button>
                            </div>
                          )}
                        </div>
                      ) : Array.isArray(customer.courses) && customer.courses.length ? (
                        customer.courses.join(', ')
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <span className={customer.hasDebt ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-green-700 dark:text-green-300'}>
                        {formatNumberEn(customer.totalDebtAmount || 0)}
                      </span>
                    </td>
                    {!isTashkiliyOnly && (
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{formatNumberEn(customer.totalPaidAmount || 0)}</td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{formatTashkentDate(customer.lastActivityAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <button
                        type="button"
                        onClick={() => openDetailsModal(customer.id)}
                        className="rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40"
                      >
                        Batafsil
                      </button>
                    </td>
                    {isAdmin && editMode && (
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <button
                          type="button"
                          onClick={() => openIdentityModal(customer)}
                          className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
                        >
                          Ism/raqam
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-600 dark:text-slate-300">Tanlangan filtr bo&apos;yicha mijoz topilmadi.</p>
        )}
      </div>
    </div>
  );
}
