'use client';

import { trpc } from '@/lib/trpc';

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
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Bildirishnomalar</h1>
        <p className="mt-1 text-sm text-gray-500">
          Navbat holati va yetkazish tarixini koвЂring
        </p>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          {notificationsQuery.isLoading ? (
            <p className="text-sm text-gray-600">Bildirishnomalar yuklanmoqda...</p>
          ) : notificationsQuery.data?.data?.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Turi</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Holat</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Urinishlar</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Xatolik</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Yaratilgan</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Amal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {notificationsQuery.data.data.map((notification: any) => (
                    <tr key={notification.id}>
                      <td className="px-4 py-3 text-sm text-gray-700">{notification.type}</td>
                      <td className="px-4 py-3 text-sm capitalize text-gray-700">{notification.status}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {notification.attempts}/{notification.maxAttempts}
                      </td>
                      <td className="px-4 py-3 text-xs text-red-700">{notification.errorMessage || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {new Date(notification.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {(notification.status === 'failed' || notification.status === 'retrying') && (
                          <button
                            type="button"
                            onClick={() => retryNotification(notification.id)}
                            disabled={retryMutation.isLoading}
                          className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                            Qayta yuborish
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-600">Hozircha bildirishnoma yoвЂq. Integratsiya hodisalari shu yerda koвЂrinadi.</p>
          )}
        </div>
      </div>
    </div>
  );
}

