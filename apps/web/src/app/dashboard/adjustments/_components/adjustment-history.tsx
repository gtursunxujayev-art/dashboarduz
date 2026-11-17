'use client';

import { useMemo, useState } from 'react';
import { IconCheck, IconInfoCircle, IconX } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatCourseBundle } from '@/lib/format';
import { getRequestSourceBundle, getRequestStatusLabel, getRequestTypeLabel } from './adjustments-helpers';
import type { AdjustmentsPageModel } from './use-adjustments-page';

const STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function requestStatusTone(status: string): string {
  if (status === 'approved') return 'badge-green';
  if (status === 'rejected') return 'badge-red';
  return 'badge-amber';
}

export function AdjustmentHistory({ vm }: { vm: AdjustmentsPageModel }) {
  const { approveRequestMutation, canApproveRefund, canApproveTariffChange, openReviewModal, rejectRequestMutation, requestsQuery } = vm;
  // UI-only view filter over the loaded history; the query itself is unchanged.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const requests = useMemo(() => (requestsQuery.data ?? []) as any[], [requestsQuery.data]);
  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = { all: requests.length, pending: 0, approved: 0, rejected: 0 };
    for (const request of requests) {
      const key: StatusFilter = request.status === 'approved' || request.status === 'rejected' ? request.status : 'pending';
      counts[key] += 1;
    }
    return counts;
  }, [requests]);
  const visibleRequests = statusFilter === 'all'
    ? requests
    : requests.filter((request) => (statusFilter === 'pending'
      ? request.status !== 'approved' && request.status !== 'rejected'
      : request.status === statusFilter));

  return (
    <section className="panel min-w-0 overflow-hidden">
      <div className="space-y-4 border-b border-gray-100 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
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

        {requests.length > 0 && (
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <div className="segmented" role="group" aria-label="Holat bo'yicha filtr">
              {STATUS_FILTERS.map((filter) => {
                const active = statusFilter === filter;
                return (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setStatusFilter(filter)}
                    className={`segmented-item inline-flex items-center gap-2 ${active ? 'segmented-item-active' : ''}`}
                  >
                    {filter === 'all' ? 'Hammasi' : getRequestStatusLabel(filter)}
                    <span className={`tabular text-xs ${active ? 'text-white/80' : 'text-gray-400'}`}>{statusCounts[filter]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="px-1 pb-2 sm:px-2">
        {requestsQuery.isLoading ? (
          <LoadingBlock message="Yuklanmoqda..." className="m-4" />
        ) : visibleRequests.length ? (
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
                {visibleRequests.map((request: any) => {
                  const canReview = request.status === 'pending'
                    && ((request.type === 'refund' && canApproveRefund) || (request.type === 'tariff_change' && canApproveTariffChange));
                  return (
                    <tr key={request.id} className={canReview ? 'bg-amber-50/40' : ''}>
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
          <EmptyState title="Hozircha so'rovlar yo'q." className="m-4" />
        )}
      </div>
    </section>
  );
}
