'use client';

import LoadingBlock from '@/components/dashboard/loading-block';
import { formatNumberEn, formatTashkentDate } from '@/lib/format';
import type { CustomersPageModel } from './use-customers-page';

export function CustomerDetailsModal({ vm }: { vm: CustomersPageModel }) {
  const { customerHistoryQuery, isDetailsModalOpen, setDetailsCustomerId, setIsDetailsModalOpen } = vm;

  return (
    <>
      {isDetailsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-6xl rounded-lg bg-white shadow-xl dark:bg-slate-900">
            <div className="border-b border-gray-100 px-6 py-4 dark:border-slate-700">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Mijoz batafsil</h2>
                  {customerHistoryQuery.data?.customer && (
                    <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                      {customerHistoryQuery.data.customer.customerNumber} - {customerHistoryQuery.data.customer.name}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsDetailsModalOpen(false);
                    setDetailsCustomerId('');
                  }}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Yopish
                </button>
              </div>
            </div>

            <div className="max-h-[75vh] space-y-5 overflow-auto px-6 py-5">
              {customerHistoryQuery.isLoading ? (
                <LoadingBlock compact message="Tarix yuklanmoqda..." />
              ) : customerHistoryQuery.error ? (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
                  {customerHistoryQuery.error.message || "Mijoz tarixini yuklab bo'lmadi."}
                </p>
              ) : (
                <>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold uppercase text-gray-700 dark:text-slate-300">Sotib olingan kurslar</h3>
                    {customerHistoryQuery.data?.courses?.length ? (
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                          <thead className="bg-gray-50 dark:bg-slate-800">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-slate-400">Sana</th>
                              <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-slate-400">Kurs / tarif / subtarif</th>
                              <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-slate-400">Mas&apos;ul agent</th>
                              <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-slate-400">Kelishuv</th>
                              <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-slate-400">Boshlang&apos;ich to&apos;lov</th>
                              <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-slate-400">Joriy qarz</th>
                              <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-slate-400">Holat</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                            {customerHistoryQuery.data.courses.map((item: any) => (
                              <tr key={item.saleIncomeId}>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{formatTashkentDate(item.entryDate)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">
                                  {[item.courseName, item.tariffName, item.subTariffName].filter(Boolean).join(' / ')}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{item.managerLabel}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{formatNumberEn(item.agreementAmount || 0)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{formatNumberEn(item.firstPaymentAmount || 0)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{formatNumberEn(item.remainingDebtAmount || 0)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{item.lifecycleStatus}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-slate-400">Kurslar topilmadi.</p>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-semibold uppercase text-gray-700 dark:text-slate-300">To&apos;lovlar tarixi</h3>
                    {customerHistoryQuery.data?.payments?.length ? (
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                          <thead className="bg-gray-50 dark:bg-slate-800">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-slate-400">Sana</th>
                              <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-slate-400">Tur</th>
                              <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-slate-400">Mas&apos;ul agent</th>
                              <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-slate-400">Kurs / tarif / subtarif</th>
                              <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-slate-400">To&apos;lov summasi</th>
                              <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-slate-400">To&apos;lovdan keyingi qarz</th>
                              <th className="px-3 py-2 text-left text-xs uppercase text-gray-500 dark:text-slate-400">Holat</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                            {customerHistoryQuery.data.payments.map((payment: any) => (
                              <tr key={payment.id}>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{formatTashkentDate(payment.entryDate)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">
                                  {payment.type === 'new_sale' ? 'Yangi sotuv' : "Qarzdorlik to'lovi"}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{payment.managerLabel}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">
                                  {[payment.courseName, payment.tariffName, payment.subTariffName].filter(Boolean).join(' / ')}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{formatNumberEn(payment.paymentAmount || 0)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{formatNumberEn(payment.remainingDebtAmount || 0)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{payment.lifecycleStatus}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-slate-400">To&apos;lovlar tarixi topilmadi.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
