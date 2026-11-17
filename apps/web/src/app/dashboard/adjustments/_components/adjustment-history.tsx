'use client';

import { IconCheck, IconInfoCircle, IconX } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatCourseBundle } from '@/lib/format';
import { getRequestSourceBundle, getRequestStatusLabel, getRequestTypeLabel } from './adjustments-helpers';
import type { AdjustmentsPageModel } from './use-adjustments-page';

function requestStatusTone(status: string): string {
  if (status === 'approved') return 'badge-green';
  if (status === 'rejected') return 'badge-red';
  return 'badge-amber';
}

export function AdjustmentHistory({ vm }: { vm: AdjustmentsPageModel }) {
  const { approveRequestMutation, canApproveRefund, canApproveTariffChange, openReviewModal, rejectRequestMutation, requestsQuery } = vm;

  return (
    <section className="panel min-w-0">
      <div className="panel-header">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="section-title">So&apos;rovlar tarixi</h2>
            {requestsQuery.data?.length ? (
              <span className="badge badge-neutral tabular">{requestsQuery.data.length}</span>
            ) : null}
          </div>
          <p className="mt-1 flex items-start gap-1.5 text-xs text-gray-500">
            <IconInfoCircle className="mt-px h-3.5 w-3.5 flex-shrink-0" stroke={1.8} />
            <span>Sariq va qizil holatdagi tushumlar bonus va umumiy tushum hisobiga kiritilmaydi.</span>
          </p>
        </div>
      </div>
      <div className="p-2 pt-4 sm:p-3 sm:pt-4">
        {requestsQuery.isLoading ? (
          <LoadingBlock message="Yuklanmoqda..." className="m-2" />
        ) : requestsQuery.data?.length ? (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="text-left">Sana</th>
                  <th className="text-left">Tur</th>
                  <th className="text-left">Mijoz</th>
                  <th className="text-left">Kurs</th>
                  <th className="text-left">Holat</th>
                  <th className="text-left">Izoh</th>
                  <th className="text-right">Amal</th>
                </tr>
              </thead>
              <tbody>
                {requestsQuery.data.map((request: any) => {
                  const canReview = request.status === 'pending'
                    && ((request.type === 'refund' && canApproveRefund) || (request.type === 'tariff_change' && canApproveTariffChange));
                  return (
                    <tr key={request.id}>
                      <td className="tabular whitespace-nowrap text-gray-600">
                        {new Date(request.createdAt).toLocaleString('en-CA', { timeZone: 'Asia/Tashkent' })}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className={`badge ${request.type === 'refund' ? 'badge-red' : 'badge-blue'}`}>
                          {getRequestTypeLabel(request.type)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <UserAvatar name={request.income.customer.name || String(request.income.customer.customerNumber || '?')} size="sm" />
                          <span className="font-medium text-gray-900">
                            {request.income.customer.customerNumber} - {request.income.customer.name}
                          </span>
                        </div>
                      </td>
                      <td className="min-w-[180px]">
                        {request.type === 'tariff_change' ? (
                          <div className="space-y-0.5">
                            <p className="text-gray-500">{getRequestSourceBundle(request) ?? '-'}</p>
                            <p className="font-medium text-gray-900">
                              &rarr; {formatCourseBundle(request.newCourse?.name, request.newTariff?.name)}
                            </p>
                          </div>
                        ) : (
                          getRequestSourceBundle(request) ?? '-'
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className={`badge ${requestStatusTone(request.status)}`}>
                          {getRequestStatusLabel(request.status)}
                        </span>
                      </td>
                      <td className="max-w-xs text-gray-600">{request.reason || request.reviewNote || '-'}</td>
                      <td className="whitespace-nowrap text-right">
                        {canReview ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openReviewModal(request.id, 'approve')}
                              disabled={approveRequestMutation.isLoading || rejectRequestMutation.isLoading}
                              className="btn btn-success btn-sm"
                            >
                              <IconCheck className="h-3.5 w-3.5" stroke={2} />
                              Qabul qilish
                            </button>
                            <button
                              type="button"
                              onClick={() => openReviewModal(request.id, 'reject')}
                              disabled={approveRequestMutation.isLoading || rejectRequestMutation.isLoading}
                              className="btn btn-danger-soft btn-sm"
                            >
                              <IconX className="h-3.5 w-3.5" stroke={2} />
                              Rad etish
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Hozircha so'rovlar yo'q." className="m-2" />
        )}
      </div>
    </section>
  );
}
