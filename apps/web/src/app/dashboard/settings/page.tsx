'use client';

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';

export default function SettingsPage() {
  const tenantQuery = trpc.tenant.get.useQuery();
  const updateTenant = trpc.tenant.update.useMutation();
  const [name, setName] = useState('');
  const [defaultChatId, setDefaultChatId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantQuery.data) {
      return;
    }
    setName(tenantQuery.data.name || '');
    const settings = (tenantQuery.data.settings as Record<string, unknown> | null) || {};
    setDefaultChatId(String(settings.notificationChatId || ''));
  }, [tenantQuery.data]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    try {
      await updateTenant.mutateAsync({
        name: name.trim() || undefined,
        settings: {
          notificationChatId: defaultChatId.trim() || null,
        },
      });
      await tenantQuery.refetch();
      setSuccess('Settings updated successfully.');
    } catch (err: any) {
      setError(err?.message || 'Failed to update settings');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-5 border-b border-gray-100">
          <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">Workspace and notification settings.</p>
        </div>
        <div className="p-6">
          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {tenantQuery.error && (
            <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{tenantQuery.error.message}</p>
          )}
          {success && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Workspace Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Workspace name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Telegram Notification Chat ID</label>
              <input
                value={defaultChatId}
                onChange={(e) => setDefaultChatId(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="e.g. 123456789"
              />
              <p className="mt-1 text-xs text-gray-500">
                If set, webhook updates can enqueue Telegram notifications to this chat.
              </p>
            </div>

            <button
              type="submit"
              disabled={updateTenant.isLoading || tenantQuery.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {updateTenant.isLoading ? 'Saving...' : 'Save Settings'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
