'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import MultiSelectDropdown from '@/components/dashboard/multi-select-dropdown';

type FieldOption = {
  key: string;
  label: string;
  source: 'catalog' | 'system';
};

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.roles?.includes('Admin'));

  const [name, setName] = useState('');
  const [defaultChatId, setDefaultChatId] = useState('');
  const [reasonFieldKey, setReasonFieldKey] = useState('');
  const [sourceFieldKey, setSourceFieldKey] = useState('');
  const [qualifiedStageIds, setQualifiedStageIds] = useState<string[]>([]);
  const [qualifiedValues, setQualifiedValues] = useState<string[]>([]);
  const [nonQualifiedValues, setNonQualifiedValues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const tenantQuery = trpc.tenant.get.useQuery();
  const fieldOptionsQuery = trpc.dashboard.fieldOptions.useQuery(undefined, {
    enabled: isAdmin,
    retry: false,
  });
  const amoPipelinesQuery = trpc.integrations.getAmoCRMPipelines.useQuery(undefined, {
    enabled: isAdmin,
    retry: false,
  });
  const reasonValueOptionsQuery = trpc.dashboard.reasonValueOptions.useQuery(
    {
      fieldKey: reasonFieldKey || undefined,
      pipelineIds: amoPipelinesQuery.data?.selectedPipelineIds?.length
        ? amoPipelinesQuery.data.selectedPipelineIds
        : undefined,
    },
    {
      enabled: isAdmin && Boolean(reasonFieldKey),
      retry: false,
    },
  );
  const updateTenant = trpc.tenant.update.useMutation();

  useEffect(() => {
    if (!tenantQuery.data) {
      return;
    }

    setName(tenantQuery.data.name || '');

    const settings = (tenantQuery.data.settings as Record<string, unknown> | null) || {};
    setDefaultChatId(String(settings.notificationChatId || ''));

    const dashboardSettings = ((settings.dashboard as Record<string, unknown> | null) || {});
    setReasonFieldKey(String(dashboardSettings.reasonFieldKey || ''));
    setSourceFieldKey(String(dashboardSettings.sourceFieldKey || ''));
    setQualifiedStageIds(Array.isArray(dashboardSettings.qualifiedStageIds) ? dashboardSettings.qualifiedStageIds.map(String) : []);
    setQualifiedValues(Array.isArray(dashboardSettings.qualifiedValues) ? dashboardSettings.qualifiedValues.map(String) : []);
    setNonQualifiedValues(Array.isArray(dashboardSettings.nonQualifiedValues) ? dashboardSettings.nonQualifiedValues.map(String) : []);
  }, [tenantQuery.data]);

  const fieldOptions = useMemo<FieldOption[]>(() => {
    const options = fieldOptionsQuery.data?.options;
    return Array.isArray(options) ? (options as FieldOption[]) : [];
  }, [fieldOptionsQuery.data]);

  const selectedPipelineIds = useMemo(() => {
    if (!amoPipelinesQuery.data) {
      return [];
    }

    if (amoPipelinesQuery.data.hasExplicitSelection) {
      return amoPipelinesQuery.data.selectedPipelineIds;
    }

    return amoPipelinesQuery.data.pipelines.map((pipeline: any) => pipeline.id);
  }, [amoPipelinesQuery.data]);

  const qualifiedStageOptions = useMemo(() => {
    const pipelines = amoPipelinesQuery.data?.pipelines || [];
    return pipelines
      .filter((pipeline: any) => selectedPipelineIds.includes(pipeline.id))
      .flatMap((pipeline: any) =>
        (Array.isArray(pipeline.statuses) ? pipeline.statuses : []).map((status: any) => ({
          id: status.id,
          label: status.name,
          description: pipeline.name,
        })),
      );
  }, [amoPipelinesQuery.data, selectedPipelineIds]);

  const reasonValueOptions = useMemo(() => {
    const values = reasonValueOptionsQuery.data?.values || [];
    return values.map((value: string) => ({ id: value, label: value }));
  }, [reasonValueOptionsQuery.data]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isAdmin) {
      setError('Only tenant admins can update settings.');
      return;
    }

    try {
      await updateTenant.mutateAsync({
        name: name.trim() || undefined,
        settings: {
          notificationChatId: defaultChatId.trim() || null,
          dashboard: {
            reasonFieldKey: reasonFieldKey || null,
            sourceFieldKey: sourceFieldKey || null,
            qualifiedStageIds,
            qualifiedValues,
            nonQualifiedValues,
          },
        },
      });
      await tenantQuery.refetch();
      if (isAdmin) {
        await fieldOptionsQuery.refetch();
      }
      setSuccess('Settings updated successfully.');
    } catch (err: any) {
      setError(err?.message || 'Failed to update settings');
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Workspace, notifications, and dashboard analytics field mapping.
          </p>
        </div>

        <div className="p-6">
          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {tenantQuery.error && (
            <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{tenantQuery.error.message}</p>
          )}
          {fieldOptionsQuery.error && isAdmin && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
              AmoCRM field catalog is unavailable. Connect and validate AmoCRM to configure live analytics fields.
            </p>
          )}
          {amoPipelinesQuery.error && isAdmin && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
              AmoCRM pipelines are unavailable. Connect AmoCRM and save pipeline selection in Integrations first.
            </p>
          )}
          {success && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}

          {!isAdmin && (
            <p className="mb-4 rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
              Settings are read-only for non-admin users.
            </p>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Workspace Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isAdmin}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                placeholder="Workspace name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Telegram Notification Chat ID</label>
              <input
                value={defaultChatId}
                onChange={(e) => setDefaultChatId(e.target.value)}
                disabled={!isAdmin}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                placeholder="e.g. 123456789"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Reason Field (Non-Qualified Pie)</label>
                <select
                  value={reasonFieldKey}
                  onChange={(e) => setReasonFieldKey(e.target.value)}
                  disabled={!isAdmin || fieldOptionsQuery.isLoading}
                  style={{ backgroundColor: '#FFFFFF', color: '#111827' }}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="" style={{ backgroundColor: '#FFFFFF', color: '#111827' }}>Select field</option>
                  {fieldOptions.map((option) => (
                    <option key={option.key} value={option.key} style={{ backgroundColor: '#FFFFFF', color: '#111827' }}>
                      {option.label} ({option.source})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Source Field (New Leads Pie)</label>
                <select
                  value={sourceFieldKey}
                  onChange={(e) => setSourceFieldKey(e.target.value)}
                  disabled={!isAdmin || fieldOptionsQuery.isLoading}
                  style={{ backgroundColor: '#FFFFFF', color: '#111827' }}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="" style={{ backgroundColor: '#FFFFFF', color: '#111827' }}>Select field</option>
                  {fieldOptions.map((option) => (
                    <option key={option.key} value={option.key} style={{ backgroundColor: '#FFFFFF', color: '#111827' }}>
                      {option.label} ({option.source})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <MultiSelectDropdown
              label="Qualified Stages"
              options={qualifiedStageOptions}
              selectedIds={qualifiedStageIds}
              onChange={setQualifiedStageIds}
              placeholder="Select stages from checked pipelines"
              disabled={!isAdmin || amoPipelinesQuery.isLoading}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <MultiSelectDropdown
                label="Qualified Values"
              options={reasonValueOptions}
              selectedIds={qualifiedValues}
              onChange={setQualifiedValues}
              placeholder={reasonFieldKey ? 'Choose values from selected reason field' : 'Select reason field first'}
              disabled={!isAdmin || !reasonFieldKey}
              loading={reasonValueOptionsQuery.isLoading}
              loadingText="Loading values from selected reason field..."
              emptyText="No values found yet for this reason field."
            />

              <MultiSelectDropdown
                label="Non-Qualified Values"
                options={reasonValueOptions}
                selectedIds={nonQualifiedValues}
                onChange={setNonQualifiedValues}
                placeholder={reasonFieldKey ? 'Choose values from selected reason field' : 'Select reason field first'}
                disabled={!isAdmin || !reasonFieldKey}
                loading={reasonValueOptionsQuery.isLoading}
                loadingText="Loading values from selected reason field..."
                emptyText="No values found yet for this reason field."
              />
            </div>

            <button
              type="submit"
              disabled={!isAdmin || updateTenant.isLoading || tenantQuery.isLoading}
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
