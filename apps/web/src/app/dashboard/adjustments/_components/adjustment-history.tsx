'use client';

import LoadingBlock from '@/components/dashboard/loading-block';
import { formatCourseBundle } from '@/lib/format';
import { getRequestSourceBundle, getRequestStatusLabel, getRequestTypeLabel } from './adjustments-helpers';
import type { AdjustmentsPageModel } from './use-adjustments-page';

export function AdjustmentHistory({ vm }: { vm: AdjustmentsPageModel }) {
  const { approveRequestMutation, canApproveRefund, canApproveTariffChange, openReviewModal, rejectRequestMutation, requestsQuery } = vm;

  return (
    <div className="rounded-lg bg-white shadow dark:bg-slate-900">
      <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
        <h2 className="text-lg font-medium text-gray-900 dark:text-slate-100">So&apos;rovlar tarixi</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          Sariq va qizil holatdagi tushumlar bonus va umumiy tushum hisobiga kiritilmaydi.
        </p>
      </div>
      <div className="p-6">
        {requestsQuery.isLoading ? (
          <LoadingBlock message="Yuklanmoqda..." />
        ) : requestsQuery.data?.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
              <thead className="bg-gray-50 dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Sana</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Tur</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Mijoz</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Kurs</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Holat</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Izoh</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Amal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
                {requestsQuery.data.map((request: any) => {
                  const canReview = request.status === 'pending'
                    && ((request.type === 'refund' && canApproveRefund) || (request.type === 'tariff_change' && canApproveTariffChange));
                  return (
                    <tr key={request.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">
                        {new Date(request.createdAt).toLocaleString('en-CA', { timeZone: 'Asia/Tashkent' })}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{getRequestTypeLabel(request.type)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">
                        {request.income.customer.customerNumber} - {request.income.customer.name}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">
                        {request.type === 'tariff_change' ? (
                          <div className="space-y-0.5">
                            <p className="text-gray-500 dark:text-slate-400">{getRequestSourceBundle(request) ?? '-'}</p>
                            <p className="font-medium text-gray-900 dark:text-slate-100">
                              &rarr; {formatCourseBundle(request.newCourse?.name, request.newTariff?.name)}
                            </p>
                          </div>
                        ) : (
                          getRequestSourceBundle(request) ?? '-'
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{getRequestStatusLabel(request.status)}</td>
                      <td className="max-w-xs px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{request.reason || request.reviewNote || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">
                        {canReview ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openReviewModal(request.id, 'approve')}
                              disabled={approveRequestMutation.isLoading || rejectRequestMutation.isLoading}
                              className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Qabul qilish
                            </button>
                            <button
                              type="button"
                              onClick={() => openReviewModal(request.id, 'reject')}
                              disabled={approveRequestMutation.isLoading || rejectRequestMutation.isLoading}
                              className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              Rad etish
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500 dark:text-slate-400">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-600 dark:text-slate-300">Hozircha so&apos;rovlar yo&apos;q.</p>
        )}
      </div>
    </div>
  );
}
