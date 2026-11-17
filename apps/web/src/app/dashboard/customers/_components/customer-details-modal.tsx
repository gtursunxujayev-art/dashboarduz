'use client';

import { IconBook2, IconBrandTelegram, IconReceipt2, IconX } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatNumberEn, formatTashkentDate } from '@/lib/format';
import type { CustomersPageModel } from './use-customers-page';

export function CustomerDetailsModal({ vm }: { vm: CustomersPageModel }) {
  const { customerHistoryQuery, isDetailsModalOpen, setDetailsCustomerId, setIsDetailsModalOpen } = vm;
  const detailsCustomer = customerHistoryQuery.data?.customer;
  const detailsCourses = customerHistoryQuery.data?.courses || [];

  return (
    <>
      {isDetailsModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-6xl">
            <div className="modal-header">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  {detailsCustomer && (
                    <UserAvatar name={detailsCustomer.name || String(detailsCustomer.customerNumber || '?')} />
                  )}
                  <div className="min-w-0">
                    <h2 className="modal-title">Mijoz batafsil</h2>
                    {detailsCustomer && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <p className="tabular text-sm text-gray-500">
                          {detailsCustomer.customerNumber} - {detailsCustomer.name}
                        </p>
                        {detailsCustomer.telegramUsername ? (
                          <span className="badge badge-neutral">
                            <IconBrandTelegram className="h-3.5 w-3.5" stroke={1.8} />
                            {detailsCustomer.telegramUsername}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsDetailsModalOpen(false);
                    setDetailsCustomerId('');
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  <IconX className="h-4 w-4" stroke={1.8} />
                  Yopish
                </button>
              </div>
            </div>

            <div className="max-h-[75vh] space-y-6 overflow-auto bg-gray-50/60 px-4 py-5 sm:px-6">
              {customerHistoryQuery.isLoading ? (
                <LoadingBlock compact message="Tarix yuklanmoqda..." />
              ) : customerHistoryQuery.error ? (
                <p className="alert alert-error">
                  {customerHistoryQuery.error.message || "Mijoz tarixini yuklab bo'lmadi."}
                </p>
              ) : (
                <>
                  <section className="panel">
                    <div className="panel-header">
                      <div className="flex items-center gap-2">
                        <IconBook2 className="h-[18px] w-[18px] text-gray-400" stroke={1.6} />
                        <h3 className="section-title">Sotib olingan kurslar</h3>
                        {customerHistoryQuery.data?.courses?.length ? (
                          <span className="badge badge-neutral tabular">{customerHistoryQuery.data.courses.length}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="p-2 sm:p-3">
                      {customerHistoryQuery.data?.courses?.length ? (
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
                              {customerHistoryQuery.data.courses.map((item: any) => (
                                <tr key={item.saleIncomeId}>
                                  <td className="tabular whitespace-nowrap text-gray-600">{formatTashkentDate(item.entryDate)}</td>
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
                    </div>
                  </section>

                  <section className="panel">
                    <div className="panel-header">
                      <div className="flex items-center gap-2">
                        <IconReceipt2 className="h-[18px] w-[18px] text-gray-400" stroke={1.6} />
                        <h3 className="section-title">To&apos;lovlar tarixi</h3>
                        {customerHistoryQuery.data?.payments?.length ? (
                          <span className="badge badge-neutral tabular">{customerHistoryQuery.data.payments.length}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="p-2 sm:p-3">
                      {customerHistoryQuery.data?.payments?.length ? (
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
                              {customerHistoryQuery.data.payments.map((payment: any) => (
                                <tr key={payment.id}>
                                  <td className="tabular whitespace-nowrap text-gray-600">{formatTashkentDate(payment.entryDate)}</td>
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
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
