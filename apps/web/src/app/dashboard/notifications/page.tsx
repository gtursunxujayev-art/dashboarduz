'use client';

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

const FEED_COLUMNS = 'md:grid md:grid-cols-[minmax(0,1.4fr)_120px_100px_minmax(0,1.6fr)_170px_150px] md:items-center md:gap-4';

export default function NotificationsPage() {
  const notificationsQuery = trpc.notifications.list.useQuery({
    page: 1,
    limit: 50,
  });
  const retryMutation = trpc.notifications.retry.useMutation();

  const retryNotification = async (id: string) => {
    await retryMutation.mutateAsync({ id });
    await notificationsQuery.refetch();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bildirishnomalar"
        description="Navbat holati va yetkazish tarixini ko'ring"
      />

      <div className="panel p-2 sm:p-3">
        {notificationsQuery.isLoading ? (
          <LoadingBlock message="Bildirishnomalar yuklanmoqda..." className="m-2" />
        ) : notificationsQuery.data?.data?.length ? (
          <div>
            <div className={`hidden h-10 rounded-[10px] bg-gray-50 px-4 text-xs font-medium tracking-[0.02em] text-gray-500 ${FEED_COLUMNS}`}>
              <span>Turi</span>
              <span>Holat</span>
              <span>Urinishlar</span>
              <span>Xatolik</span>
              <span>Yaratilgan</span>
              <span className="text-right">Amal</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {notificationsQuery.data.data.map((notification: any) => {
                const style = STATUS_STYLES[notification.status] || DEFAULT_STATUS_STYLE;
                const StatusIcon = style.icon;
                return (
                  <li
                    key={notification.id}
                    className={`flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-gray-50 ${FEED_COLUMNS}`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${style.tile}`}>
                        <StatusIcon className="h-4 w-4" stroke={1.8} />
                      </span>
                      <span className="truncate font-medium text-gray-900">{notification.type}</span>
                    </div>
                    <div>
                      <span className={`badge capitalize ${style.badge}`}>{notification.status}</span>
                    </div>
                    <div className="tabular text-sm text-gray-600">
                      {notification.attempts}/{notification.maxAttempts}
                    </div>
                    <div className="min-w-0 break-words text-xs text-red-700">{notification.errorMessage || <span className="hidden md:inline">-</span>}</div>
                    <div className="tabular text-sm text-gray-500">
                      {new Date(notification.createdAt).toLocaleString()}
                    </div>
                    <div className="md:text-right">
                      {(notification.status === 'failed' || notification.status === 'retrying') && (
                        <button
                          type="button"
                          onClick={() => retryNotification(notification.id)}
                          disabled={retryMutation.isLoading}
                          className="btn btn-secondary btn-sm"
                        >
                          <IconRefresh className="h-4 w-4" stroke={1.8} />
                          Qayta yuborish
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <EmptyState
            icon={IconBell}
            title="Hozircha bildirishnoma yo'q. Integratsiya hodisalari shu yerda ko'rinadi."
            className="m-2"
          />
        )}
      </div>
    </div>
  );
}
