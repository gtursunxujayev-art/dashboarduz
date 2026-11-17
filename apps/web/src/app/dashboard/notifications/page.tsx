'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { IconBell, IconCircleCheck, IconCircleX, IconClock, IconRefresh, IconRepeat } from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';

const STATUS_STYLES: Record<string, { badge: string; tile: string; icon: Icon }> = {
  sent: { badge: 'badge-green', tile: 'bg-emerald-50 text-emerald-600', icon: IconCircleCheck },
  failed: { badge: 'badge-red', tile: 'bg-red-50 text-red-600', icon: IconCircleX },
  retrying: { badge: 'badge-amber', tile: 'bg-amber-50 text-amber-600', icon: IconRepeat },
  pending: { badge: 'badge-blue', tile: 'bg-blue-50 text-blue-600', icon: IconClock },
};
const DEFAULT_STATUS_STYLE = { badge: 'badge-neutral', tile: 'bg-gray-100 text-gray-600', icon: IconBell };

export default function NotificationsPage() {
  const notificationsQuery = trpc.notifications.list.useQuery({
    page: 1,
    limit: 50,
  });
  const retryMutation = trpc.notifications.retry.useMutation();
  // UI-only: which status the inbox shows.
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const retryNotification = async (id: string) => {
    await retryMutation.mutateAsync({ id });
    await notificationsQuery.refetch();
  };

  const notifications = (notificationsQuery.data?.data || []) as any[];
  const statusCounts = new Map<string, number>();
  for (const notification of notifications) {
    statusCounts.set(notification.status, (statusCounts.get(notification.status) || 0) + 1);
  }
  const statuses = Array.from(statusCounts.keys());
  const activeFilter = statusFilter === 'all' || statusCounts.has(statusFilter) ? statusFilter : 'all';
  const visibleNotifications = activeFilter === 'all'
    ? notifications
    : notifications.filter((notification) => notification.status === activeFilter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bildirishnomalar"
        description="Navbat holati va yetkazish tarixini ko'ring"
      >
        {statuses.length > 1 && (
          <div className="-mx-1 overflow-x-auto px-1 py-1">
            <div className="segmented" role="group" aria-label="Holat">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                aria-pressed={activeFilter === 'all'}
                className={`segmented-item ${activeFilter === 'all' ? 'segmented-item-active' : ''}`}
              >
                Hammasi <span className="tabular ml-1 opacity-70">{notifications.length}</span>
              </button>
              {statuses.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  aria-pressed={activeFilter === status}
                  className={`segmented-item capitalize ${activeFilter === status ? 'segmented-item-active' : ''}`}
                >
                  {status} <span className="tabular ml-1 opacity-70">{statusCounts.get(status)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </PageHeader>

      <div className="panel mx-auto max-w-5xl overflow-hidden">
        {notificationsQuery.isLoading ? (
          <LoadingBlock message="Bildirishnomalar yuklanmoqda..." className="m-4" />
        ) : visibleNotifications.length ? (
          <ul className="divide-y divide-gray-100">
            {visibleNotifications.map((notification: any) => {
              const style = STATUS_STYLES[notification.status] || DEFAULT_STATUS_STYLE;
              const StatusIcon = style.icon;
              const needsAttention = notification.status === 'failed' || notification.status === 'retrying';
              return (
                <li
                  key={notification.id}
                  className={`relative flex gap-4 px-5 py-4 transition-colors hover:bg-gray-50 sm:px-6 ${needsAttention ? 'bg-red-50/30' : ''}`}
                >
                  {needsAttention && (
                    <span aria-hidden="true" className="absolute left-2 top-[30px] h-1.5 w-1.5 rounded-full bg-red-500 sm:left-2.5" />
                  )}
                  <span className={`mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${style.tile}`}>
                    <StatusIcon className="h-5 w-5" stroke={1.6} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="sr-only">Turi</span>
                        <span className={`truncate text-gray-900 ${needsAttention ? 'font-semibold' : 'font-medium'}`}>{notification.type}</span>
                        <span className="sr-only">Holat</span>
                        <span><span className={`badge capitalize ${style.badge}`}>{notification.status}</span></span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <span className="sr-only">Yaratilgan</span>
                        <span className="tabular whitespace-nowrap">{new Date(notification.createdAt).toLocaleString()}</span>
                      </div>
                    </div>

                    {notification.errorMessage && (
                      <div className="mt-1.5">
                        <span className="sr-only">Xatolik</span>
                        <span className="block break-words text-sm text-red-700">{notification.errorMessage}</span>
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <span>Urinishlar</span>
                        <span className="tabular font-medium text-gray-700">
                          {notification.attempts}/{notification.maxAttempts}
                        </span>
                      </div>
                      {needsAttention && (
                        <div>
                          <span className="sr-only">Amal</span>
                          <span>
                            <button
                              type="button"
                              onClick={() => retryNotification(notification.id)}
                              disabled={retryMutation.isLoading}
                              className="btn btn-secondary btn-sm"
                            >
                              <IconRefresh className="h-4 w-4" stroke={1.8} />
                              Qayta yuborish
                            </button>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={IconBell}
            title="Hozircha bildirishnoma yo'q. Integratsiya hodisalari shu yerda ko'rinadi."
            className="m-4"
          />
        )}
      </div>
    </div>
  );
}
