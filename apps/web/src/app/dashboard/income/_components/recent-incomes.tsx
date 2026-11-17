'use client';

import { IconChevronDown, IconPencil, IconSearch, IconTrash } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatAmountDigits } from '@/lib/format';
import { getDisplayedRemainingDebtForIncomeRow } from './income-helpers';
import type { IncomePageModel } from './use-income-page';

/** Kit badge tone for an income lifecycle status (label still comes from the page model). */
function lifecycleBadgeTone(status: string): string {
  if (status === 'pending_refund') return 'badge-amber';
  if (status === 'refunded') return 'badge-red';
  return 'badge-green';
}

export function RecentIncomes({ vm }: { vm: IncomePageModel }) {
  const { deletingIncomeId, formatIncomeType, getLifecycleStatusBadge, handleDeleteIncome, incomesQuery, isAdmin, openEditIncome, recentLimit, recentSearchQuery, setRecentLimit, setRecentSearchQuery } = vm;

  return (
    <section className="panel">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <h2 className="section-title">So'nggi tushumlar</h2>
          {incomesQuery.data?.length ? (
            <span className="badge badge-neutral tabular">{incomesQuery.data.length}</span>
          ) : null}
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
            <input
              value={recentSearchQuery}
              onChange={(event) => {
                setRecentSearchQuery(event.target.value);
                setRecentLimit(10);
              }}
              placeholder="Mijoz raqami yoki ismi bo'yicha qidirish"
              aria-label="Mijoz raqami yoki ismi bo'yicha qidirish"
              className="field pl-9"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setRecentSearchQuery('');
              setRecentLimit(10);
            }}
            disabled={!recentSearchQuery}
            className="btn btn-ghost"
          >
            Tozalash
          </button>
        </div>
      </div>

      <div className="p-2 pt-4 sm:p-3 sm:pt-4">
        {incomesQuery.isLoading ? (
          <LoadingBlock message="Tushumlar yuklanmoqda..." className="m-2" />
        ) : incomesQuery.data?.length ? (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-left">Sana</th>
                    <th className="text-left">Turi</th>
                    <th className="text-left">Mijoz</th>
                    <th className="text-left">Menedjer</th>
                    <th className="w-16 min-w-[64px] text-left">Kiritgan</th>
                    <th className="text-left">Kurs/Tarif</th>
                    <th className="text-left">Holat</th>
                    <th className="text-right">To'lov</th>
                    <th className="text-right">Qoldiq qarz</th>
                    {isAdmin && (
                      <th className="text-right">Amal</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {incomesQuery.data.map((income) => {
                    const lifecycleBadge = getLifecycleStatusBadge(income.lifecycleStatus);
                    const remainingDebt = getDisplayedRemainingDebtForIncomeRow(income);
                    return (
                      <tr key={income.id}>
                        <td className="tabular whitespace-nowrap text-gray-600">
                          {new Date(income.entryDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })}
                        </td>
                        <td className="whitespace-nowrap">
                          <span className={`badge ${income.type === 'repayment' ? 'badge-neutral' : 'badge-blue'}`}>
                            {formatIncomeType(income.type)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            <UserAvatar name={income.customer?.name || String(income.customer?.customerNumber || '?')} size="sm" />
                            <span className="font-medium text-gray-900">
                              {income.customer?.customerNumber} - {income.customer?.name}
                            </span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap text-gray-700">
                          {income.manager?.name || income.manager?.username || '-'}
                        </td>
                        <td className="whitespace-nowrap text-[11px] leading-tight text-gray-500">
                          {income.createdByLabel || '-'}
                        </td>
                        <td className="whitespace-nowrap text-gray-700">
                          {[income.course?.name, income.tariff?.name].filter(Boolean).join(' / ') || '-'}
                        </td>
                        <td className="whitespace-nowrap">
                          <span className={`badge ${lifecycleBadgeTone(income.lifecycleStatus)}`}>
                            {lifecycleBadge.label}
                          </span>
                        </td>
                        <td className="tabular whitespace-nowrap text-right font-medium text-gray-900">
                          {formatAmountDigits(income.paymentAmount)}
                        </td>
                        <td className={`tabular whitespace-nowrap text-right ${remainingDebt > 0 ? 'font-medium text-amber-700' : 'text-gray-500'}`}>
                          {formatAmountDigits(remainingDebt)}
                        </td>
                        {isAdmin && (
                          <td className="whitespace-nowrap text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEditIncome(income)}
                                className="btn btn-soft btn-sm"
                              >
                                <IconPencil className="h-3.5 w-3.5" stroke={1.8} />
                                Tahrirlash
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteIncome(income.id)}
                                disabled={deletingIncomeId === income.id}
                                className="btn btn-danger-soft btn-sm"
                              >
                                <IconTrash className="h-3.5 w-3.5" stroke={1.8} />
                                {deletingIncomeId === income.id ? "O'chirilmoqda..." : "O'chirish"}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {incomesQuery.data.length >= recentLimit && recentLimit < 200 && (
              <div className="flex justify-center pb-2">
                <button
                  type="button"
                  onClick={() => setRecentLimit((prev) => Math.min(prev + 20, 200))}
                  className="btn btn-secondary btn-sm"
                >
                  <IconChevronDown className="h-4 w-4" stroke={1.8} />
                  Yana yuklash (+20)
                </button>
              </div>
            )}
          </div>
        ) : (
          <EmptyState title="Hozircha tushum yozuvlari yo'q." className="m-2" />
        )}
      </div>
    </section>
  );
}
