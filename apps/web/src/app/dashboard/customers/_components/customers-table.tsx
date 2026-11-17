'use client';

import { IconBook2, IconBrandTelegram, IconChevronRight, IconId, IconPencil, IconUsers } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatNumberEn, formatTashkentDate } from '@/lib/format';
import type { CustomersPageModel } from './use-customers-page';

export function CustomersTable({ vm }: { vm: CustomersPageModel }) {
  const { customers, customersQuery, editMode, handleToggleCustomer, handleToggleSelectAll, isAdmin, isAllSelected, isTashkiliyOnly, openCourseEditorModal, openDetailsModal, openIdentityModal, selectedCustomerIds } = vm;

  return (
    <div className="panel overflow-hidden">
      {customersQuery.isLoading ? (
        <LoadingBlock message="Mijozlar yuklanmoqda..." className="m-3" />
      ) : customersQuery.error ? (
        <p className="alert alert-error m-3">
          {customersQuery.error.message || "Mijozlarni yuklab bo'lmadi."}
        </p>
      ) : customers.length ? (
        <div className="overflow-x-auto px-2 pb-2 sm:px-3">
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
                <th>
                  <span>Mijoz ismi</span>
                  <span className="text-gray-300" aria-hidden="true"> / </span>
                  <span>Mijoz raqami</span>
                </th>
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
                        <UserAvatar name={customer.name || String(customer.customerNumber || '?')} />
                        <div className="min-w-0">
                          <p className="font-medium leading-tight text-gray-900">{customer.name}</p>
                          <p className="tabular mt-0.5 text-[13px] text-gray-500">{customer.customerNumber}</p>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-gray-600">
                      {customer.telegramUsername ? (
                        <span className="inline-flex items-center gap-1.5">
                          <IconBrandTelegram className="h-4 w-4 text-gray-400" stroke={1.8} aria-hidden="true" />
                          {customer.telegramUsername}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="whitespace-nowrap">{customer.responsibleManagerLabel || '-'}</td>
                    <td className="min-w-[200px]">
                      {Array.isArray(customer.courseEntries) && customer.courseEntries.length ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {customer.courseEntries.map((entry: any) => (
                            <span key={entry.saleIncomeId} className="badge badge-blue max-w-[220px]">
                              <IconBook2 className="h-3.5 w-3.5 flex-shrink-0" stroke={1.8} aria-hidden="true" />
                              <span className="truncate">{entry.label}</span>
                            </span>
                          ))}
                          {isAdmin && editMode && (
                            <button
                              type="button"
                              onClick={() => openCourseEditorModal(customer.id)}
                              className="btn btn-sm btn-ghost"
                            >
                              <IconPencil className="h-3.5 w-3.5" stroke={1.8} />
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
                        {customer.hasDebt ? <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" /> : null}
                        {formatNumberEn(customer.totalDebtAmount || 0)}
                      </span>
                    </td>
                    {!isTashkiliyOnly && (
                      <td className="tabular whitespace-nowrap text-right font-medium text-gray-900">{formatNumberEn(customer.totalPaidAmount || 0)}</td>
                    )}
                    <td className="tabular whitespace-nowrap text-gray-500">{formatTashkentDate(customer.lastActivityAt)}</td>
                    <td className="whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={() => openDetailsModal(customer.id)}
                        className="btn btn-sm btn-ghost"
                      >
                        Batafsil
                        <IconChevronRight className="h-3.5 w-3.5" stroke={1.8} />
                      </button>
                    </td>
                    {isAdmin && editMode && (
                      <td className="whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openIdentityModal(customer)}
                          className="btn btn-sm btn-ghost"
                        >
                          <IconId className="h-3.5 w-3.5" stroke={1.8} />
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
        <EmptyState title="Tanlangan filtr bo'yicha mijoz topilmadi." icon={IconUsers} className="m-3" />
      )}
    </div>
  );
}
