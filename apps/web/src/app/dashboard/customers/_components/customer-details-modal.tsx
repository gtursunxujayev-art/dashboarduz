'use client';

import type { ReactNode } from 'react';
import type { Icon } from '@tabler/icons-react';
import { IconBook2, IconBrandTelegram, IconReceipt2, IconUserCheck, IconX } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { getInitials } from '@/components/ui/user-avatar';
import { formatNumberEn, formatTashkentDate } from '@/lib/format';
import type { CustomersPageModel } from './use-customers-page';

function InfoRow({ icon: RowIcon, label, children }: { icon: Icon; label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <dt className="flex items-center gap-2.5 text-sm text-gray-600">
        <RowIcon className="h-[18px] w-[18px] flex-shrink-0 text-gray-400" stroke={1.6} aria-hidden="true" />
        {label}
      </dt>
      <dd className="min-w-0 text-sm font-medium text-gray-900 sm:text-right">{children}</dd>
    </div>
  );
}

function HistoryPanel({ icon: PanelIcon, title, count, children }: { icon: Icon; title: ReactNode; count?: number; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-header pt-5 sm:pt-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600">
            <PanelIcon className="h-4 w-4" stroke={1.8} />
          </span>
          <h3 className="section-title">{title}</h3>
          {count ? <span className="badge badge-neutral tabular">{count}</span> : null}
        </div>
      </div>
      <div className="px-2 pb-2 pt-1 sm:px-3">{children}</div>
    </section>
  );
}

export function CustomerDetailsModal({ vm }: { vm: CustomersPageModel }) {
  const { customerHistoryQuery, isDetailsModalOpen, isTashkiliyOnly, setDetailsCustomerId, setIsDetailsModalOpen } = vm;
  const detailsCustomer = customerHistoryQuery.data?.customer;
  const detailsCourses: any[] = customerHistoryQuery.data?.courses || [];
  const detailsPayments: any[] = customerHistoryQuery.data?.payments || [];

  const courseNames = Array.from(new Set(detailsCourses.map((item) => item.courseName).filter((name) => name && name !== '-')));
  const managerLabels = Array.from(new Set(detailsCourses.map((item) => item.managerLabel).filter(Boolean)));

  return (
    <>
      {isDetailsModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-[880px]">
            <div className="modal-header">
              <div className="flex items-center justify-between gap-4">
                <h2 className="modal-title">Mijoz batafsil</h2>
                <button
                  type="button"
                  onClick={() => {
                    setIsDetailsModalOpen(false);
                    setDetailsCustomerId('');
                  }}
                  className="btn btn-ghost btn-sm"
                >
                  <IconX className="h-4 w-4" stroke={1.8} />
                  Yopish
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-4 bg-gray-50/60 px-4 py-5 sm:px-6">
              {detailsCustomer && (
                <div className="flex min-w-0 items-center gap-4 px-1">
                  <span
                    aria-hidden="true"
                    className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-lg font-semibold text-blue-700"
                  >
                    {getInitials(detailsCustomer.name || String(detailsCustomer.customerNumber || '?'))}
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-lg font-semibold tracking-tight text-gray-900">{detailsCustomer.name}</p>
                    <p className="tabular mt-0.5 text-sm text-gray-500">{detailsCustomer.customerNumber}</p>
                  </div>
                </div>
              )}

              {customerHistoryQuery.isLoading ? (
                <LoadingBlock compact message="Tarix yuklanmoqda..." />
              ) : customerHistoryQuery.error ? (
                <p className="alert alert-error">
                  {customerHistoryQuery.error.message || "Mijoz tarixini yuklab bo'lmadi."}
                </p>
              ) : (
                <>
                  <section className="panel px-5 py-2 sm:px-6">
                    <dl className="divide-y divide-gray-100">
                      <InfoRow icon={IconBrandTelegram} label="Telegram">
                        {detailsCustomer?.telegramUsername || '-'}
                      </InfoRow>
                      <InfoRow icon={IconBook2} label="Kurslar">
                        {courseNames.length ? (
                          <span className="flex flex-wrap gap-1.5 sm:justify-end">
                            {courseNames.map((name) => (
                              <span key={name} className="badge badge-blue">
                                <IconBook2 className="h-3.5 w-3.5" stroke={1.8} aria-hidden="true" />
                                {name}
                              </span>
                            ))}
                          </span>
                        ) : '-'}
                      </InfoRow>
                      <InfoRow icon={IconUserCheck} label={<>Mas&apos;ul agent</>}>
                        {managerLabels.length ? managerLabels.join(', ') : '-'}
                      </InfoRow>
                    </dl>
                  </section>

                  <HistoryPanel icon={IconBook2} title="Sotib olingan kurslar" count={detailsCourses.length}>
                    {detailsCourses.length ? (
                      <div className="overflow-x-auto">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th className="text-left">Sana</th>
                              <th className="text-left">Kurs / tarif / subtarif</th>
                              <th className="text-left">Mas&apos;ul agent</th>
                              <th className="text-right">Kelishuv</th>
                              <th className="text-right">Boshlang&apos;ich to&apos;lov</th>
                              <th className="text-right">Joriy qarz</th>
                              <th className="text-left">Holat</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailsCourses.map((item: any) => (
                              <tr key={item.saleIncomeId}>
                                <td className="tabular whitespace-nowrap text-gray-500">{formatTashkentDate(item.entryDate)}</td>
                                <td className="whitespace-nowrap font-medium text-gray-900">
                                  {[item.courseName, item.tariffName, item.subTariffName].filter(Boolean).join(' / ')}
                                </td>
                                <td className="whitespace-nowrap">{item.managerLabel}</td>
                                <td className="tabular whitespace-nowrap text-right">{formatNumberEn(item.agreementAmount || 0)}</td>
                                <td className="tabular whitespace-nowrap text-right">{formatNumberEn(item.firstPaymentAmount || 0)}</td>
                                <td className="tabular whitespace-nowrap text-right">
                                  <span className={Number(item.remainingDebtAmount || 0) > 0 ? 'font-medium text-amber-700' : 'text-gray-700'}>
                                    {formatNumberEn(item.remainingDebtAmount || 0)}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap">
                                  <span className="badge badge-neutral">{item.lifecycleStatus}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <EmptyState title="Kurslar topilmadi." icon={IconBook2} className="m-1" />
                    )}
                  </HistoryPanel>

                  <HistoryPanel icon={IconReceipt2} title={<>To&apos;lovlar tarixi</>} count={detailsPayments.length}>
                    {detailsPayments.length ? (
                      <div className="overflow-x-auto">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th className="text-left">Sana</th>
                              <th className="text-left">Tur</th>
                              <th className="text-left">Mas&apos;ul agent</th>
                              <th className="text-left">Kurs / tarif / subtarif</th>
                              <th className="text-right">To&apos;lov summasi</th>
                              <th className="text-right">To&apos;lovdan keyingi qarz</th>
                              <th className="text-left">Holat</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailsPayments.map((payment: any) => (
                              <tr key={payment.id}>
                                <td className="tabular whitespace-nowrap text-gray-500">{formatTashkentDate(payment.entryDate)}</td>
                                <td className="whitespace-nowrap">
                                  <span className={`badge ${payment.type === 'new_sale' ? 'badge-blue' : 'badge-neutral'}`}>
                                    {payment.type === 'new_sale' ? 'Yangi sotuv' : "Qarzdorlik to'lovi"}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap">{payment.managerLabel}</td>
                                <td className="whitespace-nowrap">
                                  {[payment.courseName, payment.tariffName, payment.subTariffName].filter(Boolean).join(' / ')}
                                </td>
                                <td className="tabular whitespace-nowrap text-right font-medium text-gray-900">{formatNumberEn(payment.paymentAmount || 0)}</td>
                                <td className="tabular whitespace-nowrap text-right">{formatNumberEn(payment.remainingDebtAmount || 0)}</td>
                                <td className="whitespace-nowrap">
                                  <span className="badge badge-neutral">{payment.lifecycleStatus}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <EmptyState title="To'lovlar tarixi topilmadi." icon={IconReceipt2} className="m-1" />
                    )}
                  </HistoryPanel>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
