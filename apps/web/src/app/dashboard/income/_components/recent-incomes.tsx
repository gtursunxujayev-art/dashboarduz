'use client';

import LoadingBlock from '@/components/dashboard/loading-block';
import { formatAmountDigits } from '@/lib/format';
import { getDisplayedRemainingDebtForIncomeRow } from './income-helpers';
import type { IncomePageModel } from './use-income-page';

export function RecentIncomes({ vm }: { vm: IncomePageModel }) {
  const { deletingIncomeId, formatIncomeType, getLifecycleStatusBadge, handleDeleteIncome, incomesQuery, isAdmin, openEditIncome, recentLimit, recentSearchQuery, setRecentLimit, setRecentSearchQuery } = vm;

  return (
    <div className="rounded-lg bg-white shadow dark:bg-slate-900">
      <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
        <h2 className="text-lg font-medium text-gray-900 dark:text-slate-100">So'nggi tushumlar</h2>
      </div>

      <div className="p-6">
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={recentSearchQuery}
            onChange={(event) => {
              setRecentSearchQuery(event.target.value);
              setRecentLimit(10);
            }}
            placeholder="Mijoz raqami yoki ismi bo'yicha qidirish"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={() => {
              setRecentSearchQuery('');
              setRecentLimit(10);
            }}
            disabled={!recentSearchQuery}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Tozalash
          </button>
        </div>

        {incomesQuery.isLoading ? (
          <LoadingBlock message="Tushumlar yuklanmoqda..." />
        ) : incomesQuery.data?.length ? (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-800">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Sana</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Turi</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Mijoz</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Menedjer</th>
                  <th className="w-16 min-w-[64px] px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Kiritgan</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Kurs/Tarif</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Holat</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">To'lov</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Qoldiq qarz</th>
                  {isAdmin && (
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Amal</th>
                  )}
                </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
                  {incomesQuery.data.map((income) => (
                    <tr key={income.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                        {new Date(income.entryDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                        {formatIncomeType(income.type)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                        {income.customer?.customerNumber} - {income.customer?.name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                        {income.manager?.name || income.manager?.username || '-'}
                      </td>
                      <td className="whitespace-nowrap px-2 py-3 text-[10px] leading-tight text-gray-500 dark:text-slate-400">
                        {income.createdByLabel || '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                        {[income.course?.name, income.tariff?.name].filter(Boolean).join(' / ') || '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getLifecycleStatusBadge(income.lifecycleStatus).className}`}>
                          {getLifecycleStatusBadge(income.lifecycleStatus).label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{formatAmountDigits(income.paymentAmount)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                        {formatAmountDigits(getDisplayedRemainingDebtForIncomeRow(income))}
                      </td>
                      {isAdmin && (
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openEditIncome(income)}
                              className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/40"
                            >
                              Tahrirlash
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteIncome(income.id)}
                              disabled={deletingIncomeId === income.id}
                              className="rounded-md border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/40"
                            >
                              {deletingIncomeId === income.id ? "O'chirilmoqda..." : "O'chirish"}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {incomesQuery.data.length >= recentLimit && recentLimit < 200 && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setRecentLimit((prev) => Math.min(prev + 20, 200))}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Yana yuklash (+20)
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-600 dark:text-slate-300">Hozircha tushum yozuvlari yo'q.</p>
        )}
      </div>
    </div>
  );
}
