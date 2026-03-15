'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';

type IntegrationId = 'amocrm' | 'telegram' | 'google_sheets' | 'voip_utel';

const integrationCatalog: Array<{
  id: IntegrationId;
  name: string;
  description: string;
  color: string;
}> = [
  {
    id: 'amocrm',
    name: 'AmoCRM',
    description: 'Connect by long-lived token for leads/contacts sync and webhook ingestion.',
    color: 'bg-blue-50 border-blue-200',
  },
  {
    id: 'telegram',
    name: 'Telegram Bot',
    description: 'Connect bot token, auto-register webhook, and send notifications.',
    color: 'bg-cyan-50 border-cyan-200',
  },
  {
    id: 'google_sheets',
    name: 'Google Sheets',
    description: 'Deferred for MVP (disabled).',
    color: 'bg-gray-50 border-gray-200',
  },
  {
    id: 'voip_utel',
    name: 'VoIP (Webhook)',
    description: 'Webhook-only mode: ingest call events from UTeL and other operators.',
    color: 'bg-purple-50 border-purple-200',
  },
];

function statusBadge(status: string) {
  switch (status) {
    case 'active':
      return 'text-green-700 bg-green-100';
    case 'pending':
      return 'text-amber-700 bg-amber-100';
    case 'error':
      return 'text-red-700 bg-red-100';
    default:
      return 'text-gray-700 bg-gray-100';
  }
}

function statusText(status: string) {
  switch (status) {
    case 'active':
      return 'Connected';
    case 'pending':
      return 'Pending';
    case 'error':
      return 'Error';
    default:
      return 'Not Connected';
  }
}

export default function IntegrationCards() {
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<IntegrationId | null>(null);
  const [amocrmLongLivedToken, setAmocrmLongLivedToken] = useState('');
  const [amocrmBaseUrl, setAmocrmBaseUrl] = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<string[]>([]);

  const listQuery = trpc.integrations.list.useQuery();
  const amoPipelinesQuery = trpc.integrations.getAmoCRMPipelines.useQuery(undefined, {
    enabled: Boolean(listQuery.data?.find((it: any) => it.type === 'amocrm' && it.status === 'active')),
    retry: false,
  });
  const connectAmoCRM = trpc.integrations.connectAmoCRM.useMutation();
  const connectTelegram = trpc.integrations.connectTelegram.useMutation();
  const connectVoIP = trpc.integrations.connectVoIP.useMutation();
  const updateAmoCRMPipelines = trpc.integrations.updateAmoCRMPipelines.useMutation();
  const disconnectIntegration = trpc.integrations.disconnect.useMutation();

  const integrations = useMemo(() => {
    return integrationCatalog.map((item) => {
      const connected = listQuery.data?.find((it: any) => it.type === item.id);
      return {
        ...item,
        status: connected?.status || 'disconnected',
        config: (connected?.config as Record<string, unknown> | undefined) || undefined,
        lastSyncAt: connected?.lastSyncAt as string | undefined,
      };
    });
  }, [listQuery.data]);

  useEffect(() => {
    if (!amoPipelinesQuery.data) {
      return;
    }

    const availableIds = amoPipelinesQuery.data.pipelines.map((pipeline: any) => pipeline.id);
    if (amoPipelinesQuery.data.hasExplicitSelection) {
      setSelectedPipelineIds(amoPipelinesQuery.data.selectedPipelineIds);
      return;
    }

    setSelectedPipelineIds(availableIds);
  }, [amoPipelinesQuery.data]);

  const handleConnect = async (integrationId: IntegrationId) => {
    setError(null);
    setActionLoading(integrationId);

    try {
      if (integrationId === 'amocrm') {
        if (!amocrmLongLivedToken.trim()) {
          throw new Error('AmoCRM long-lived token is required');
        }
        await connectAmoCRM.mutateAsync({
          longLivedToken: amocrmLongLivedToken.trim(),
          baseUrl: amocrmBaseUrl.trim() || undefined,
        });
        setAmocrmLongLivedToken('');
        setAmocrmBaseUrl('');
        await listQuery.refetch();
        return;
      }

      if (integrationId === 'telegram') {
        if (!telegramToken.trim()) {
          throw new Error('Telegram bot token is required');
        }
        await connectTelegram.mutateAsync({ botToken: telegramToken.trim() });
        setTelegramToken('');
        await listQuery.refetch();
        return;
      }

      if (integrationId === 'voip_utel') {
        await connectVoIP.mutateAsync({});
        await listQuery.refetch();
        return;
      }

      setError('Google Sheets integration is disabled in MVP');
    } catch (err: any) {
      setError(err?.message || `Failed to connect ${integrationId}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDisconnect = async (integrationId: IntegrationId) => {
    if (integrationId === 'google_sheets') {
      return;
    }
    setError(null);
    setActionLoading(integrationId);
    try {
      await disconnectIntegration.mutateAsync({ type: integrationId });
      await listQuery.refetch();
    } catch (err: any) {
      setError(err?.message || `Failed to disconnect ${integrationId}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSavePipelines = async () => {
    setError(null);
    setActionLoading('amocrm');
    try {
      await updateAmoCRMPipelines.mutateAsync({
        pipelineIds: selectedPipelineIds,
      });
      await Promise.all([listQuery.refetch(), amoPipelinesQuery.refetch()]);
    } catch (err: any) {
      setError(err?.message || 'Failed to update AmoCRM pipelines');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {integrations.map((integration) => {
          const integrationConfig = integration.config || {};
          const webhookUrl = String((integrationConfig as any).webhookUrl || '');
          const loading = actionLoading === integration.id;
          const pipelines = amoPipelinesQuery.data?.pipelines || [];
          const isAmoActive = integration.id === 'amocrm' && integration.status === 'active';

          return (
            <div key={integration.id} className={`rounded-lg border p-4 ${integration.color}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-base font-semibold text-gray-900">{integration.name}</h4>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge(integration.status)}`}>
                  {statusText(integration.status)}
                </span>
              </div>

              <p className="mt-1 text-sm text-gray-600">{integration.description}</p>

              {integration.status === 'active' && (
                <div className="mt-3 space-y-1 text-xs text-gray-600">
                  {integration.lastSyncAt && <p>Last sync: {new Date(integration.lastSyncAt).toLocaleString()}</p>}
                  {(integrationConfig as any).lastValidatedAt && (
                    <p>Last validation: {new Date(String((integrationConfig as any).lastValidatedAt)).toLocaleString()}</p>
                  )}
                  {webhookUrl && <p className="break-all">Webhook: {webhookUrl}</p>}
                  {(integrationConfig as any).connectionMode && (
                    <p>Mode: {String((integrationConfig as any).connectionMode)}</p>
                  )}
                </div>
              )}

              {isAmoActive && (
                <div className="mt-4 rounded-md border border-blue-100 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Pipelines Included in Live Reads</p>
                      <p className="text-xs text-gray-500">
                        Dashboard analytics, live lead pages, and webhook lead ingestion use only checked pipelines.
                      </p>
                    </div>
                    <span className="text-xs text-gray-500">
                      {selectedPipelineIds.length}/{pipelines.length} selected
                    </span>
                  </div>

                  {amoPipelinesQuery.isLoading ? (
                    <p className="mt-3 text-sm text-gray-500">Loading pipelines...</p>
                  ) : pipelines.length === 0 ? (
                    <p className="mt-3 text-sm text-gray-500">No pipelines returned by AmoCRM.</p>
                  ) : (
                    <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                      {pipelines.map((pipeline: any) => (
                        <label key={pipeline.id} className="flex items-start gap-3 rounded-md border border-gray-100 px-3 py-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={selectedPipelineIds.includes(pipeline.id)}
                            onChange={(event) => {
                              setSelectedPipelineIds((current) => {
                                if (event.target.checked) {
                                  return Array.from(new Set([...current, pipeline.id]));
                                }
                                return current.filter((id) => id !== pipeline.id);
                              });
                            }}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900">{pipeline.name}</p>
                            {Array.isArray(pipeline.statuses) && pipeline.statuses.length > 0 && (
                              <p className="text-xs text-gray-500">
                                Statuses: {pipeline.statuses.map((status: any) => status.name).join(', ')}
                              </p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={handleSavePipelines}
                      disabled={loading || amoPipelinesQuery.isLoading}
                      className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? 'Saving...' : 'Save Pipeline Selection'}
                    </button>
                  </div>
                </div>
              )}

              {integration.id === 'amocrm' && integration.status !== 'active' && (
                <div className="mt-4 space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-700">AmoCRM Long-lived Token</label>
                    <input
                      type="password"
                      value={amocrmLongLivedToken}
                      onChange={(e) => setAmocrmLongLivedToken(e.target.value)}
                      placeholder="Long-lived token"
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">AmoCRM Base URL (optional)</label>
                    <input
                      type="url"
                      value={amocrmBaseUrl}
                      onChange={(e) => setAmocrmBaseUrl(e.target.value)}
                      placeholder="https://www.amocrm.ru"
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}

              {integration.id === 'telegram' && integration.status === 'disconnected' && (
                <div className="mt-4">
                  <label className="block text-xs font-medium text-gray-700">Telegram Bot Token</label>
                  <input
                    type="password"
                    value={telegramToken}
                    onChange={(e) => setTelegramToken(e.target.value)}
                    placeholder="123456:ABC..."
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              )}

              <div className="mt-4 flex gap-2">
                {integration.status === 'disconnected' || (integration.id === 'amocrm' && integration.status !== 'active') ? (
                  <button
                    type="button"
                    onClick={() => handleConnect(integration.id)}
                    disabled={loading || integration.id === 'google_sheets'}
                    className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? 'Connecting...' : integration.id === 'google_sheets' ? 'Disabled' : integration.id === 'amocrm' ? 'Connect by Token' : 'Connect'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleDisconnect(integration.id)}
                    disabled={loading}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? 'Updating...' : 'Disconnect'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
