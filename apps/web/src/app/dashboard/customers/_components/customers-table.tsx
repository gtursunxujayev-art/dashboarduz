'use client';

import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatNumberEn, formatTashkentDate } from '@/lib/format';
import type { CustomersPageModel } from './use-customers-page';

export function CustomersTable({ vm }: { vm: CustomersPageModel }) {
  const { customers, customersQuery, editMode, handleToggleCustomer, handleToggleSelectAll, isAdmin, isAllSelected, isTashkiliyOnly, openCourseEditorModal, openDetailsModal, openIdentityModal, selectedCustomerIds } = vm;

  return (
    <div className="panel p-2 sm:p-3">
      {customersQuery.isLoading ? (
        <LoadingBlock message="Mijozlar yuklanmoqda..." className="m-2" />
      ) : customersQuery.error ? (
        <p className="alert alert-error m-2">
          {customersQuery.error.message || "Mijozlarni yuklab bo'lmadi."}
        </p>
      ) : customers.length ? (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                {isAdmin && editMode && (
                  <th className="w-10">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={handleToggleSelectAll}
                      aria-label="Barchasini tanlash"
                      className="checkbox"
                    />
                  </th>
                )}
                <th>Mijoz ismi</th>
                <th>Mijoz raqami</th>
                <th>Telegram</th>
                <th>Mas&apos;ul agent</th>
                <th>Kurslar</th>
                <th className="text-right">Qarz</th>
                {!isTashkiliyOnly && <th className="text-right">Jami to&apos;langan</th>}
                <th>Oxirgi faollik</th>
                <th className="text-right">Batafsil</th>
                {isAdmin && editMode && <th>Amal</th>}
              </tr>
            </thead>
            <tbody>
              {customers.map((customer: any) => {
                const selected = selectedCustomerIds.includes(customer.id);
                return (
                  <tr key={customer.id} className={selected ? 'bg-blue-50/60' : ''}>
                    {isAdmin && editMode && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => handleToggleCustomer(customer.id)}
                          aria-label={`${customer.name || customer.customerNumber} tanlash`}
                          className="checkbox"
                        />
                      </td>
                    )}
                    <td className="whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <UserAvatar name={customer.name || String(customer.customerNumber || '?')} size="sm" />
                        <span className="font-medium text-gray-900">{customer.name}</span>
                      </div>
                    </td>
                    <td className="tabular whitespace-nowrap text-gray-600">{customer.customerNumber}</td>
                    <td className="whitespace-nowrap text-gray-600">{customer.telegramUsername || '-'}</td>
                    <td className="whitespace-nowrap">{customer.responsibleManagerLabel || '-'}</td>
                    <td className="min-w-[180px]">
                      {Array.isArray(customer.courseEntries) && customer.courseEntries.length ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {customer.courseEntries.map((entry: any) => (
                            <span key={entry.saleIncomeId} className="badge badge-neutral max-w-[220px]">
                              <span className="truncate">{entry.label}</span>
                            </span>
                          ))}
                          {isAdmin && editMode && (
                            <button
                              type="button"
                              onClick={() => openCourseEditorModal(customer.id)}
                              className="btn btn-sm btn-soft"
                            >
                              Tahrirlash
                            </button>
                          )}
                        </div>
                      ) : Array.isArray(customer.courses) && customer.courses.length ? (
                        customer.courses.join(', ')
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="tabular whitespace-nowrap text-right">
                      <span className={customer.hasDebt ? 'badge badge-amber' : 'font-medium text-emerald-700'}>
                        {formatNumberEn(customer.totalDebtAmount || 0)}
                      </span>
                    </td>
                    {!isTashkiliyOnly && (
                      <td className="tabular whitespace-nowrap text-right font-medium text-gray-900">{formatNumberEn(customer.totalPaidAmount || 0)}</td>
                    )}
                    <td className="tabular whitespace-nowrap text-gray-600">{formatTashkentDate(customer.lastActivityAt)}</td>
                    <td className="whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={() => openDetailsModal(customer.id)}
                        className="btn btn-sm btn-secondary"
                      >
                        Batafsil
                      </button>
                    </td>
                    {isAdmin && editMode && (
                      <td className="whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openIdentityModal(customer)}
                          className="btn btn-sm btn-soft"
                        >
                          Ism/raqam
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="Tanlangan filtr bo'yicha mijoz topilmadi." className="m-2" />
      )}
    </div>
  );
}
