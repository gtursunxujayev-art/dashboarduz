'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';

type IntegrationId = 'amocrm' | 'telegram' | 'google_sheets' | 'voip_utel';
type TelegramReportRecipient = {
  chatId: string;
  displayName: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  selectedForReports: boolean;
  startedAt?: string | null;
  lastSeenAt?: string | null;
};

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
  const [selectedTelegramRecipientIds, setSelectedTelegramRecipientIds] = useState<string[]>([]);
  const [telegramSelectionSavedAt, setTelegramSelectionSavedAt] = useState<string | null>(null);
  const [telegramReportSentMessage, setTelegramReportSentMessage] = useState<string | null>(null);

  const listQuery = trpc.integrations.list.useQuery();
  const telegramConnected = Boolean(listQuery.data?.find((it: any) => it.type === 'telegram' && it.status === 'active'));
  const amoPipelinesQuery = trpc.integrations.getAmoCRMPipelines.useQuery(undefined, {
    enabled: Boolean(listQuery.data?.find((it: any) => it.type === 'amocrm' && it.status === 'active')),
    retry: false,
  });
  const telegramRecipientsQuery = trpc.integrations.getTelegramReportRecipients.useQuery(undefined, {
    enabled: telegramConnected,
    retry: false,
  });
  const connectAmoCRM = trpc.integrations.connectAmoCRM.useMutation();
  const connectTelegram = trpc.integrations.connectTelegram.useMutation();
  const connectVoIP = trpc.integrations.connectVoIP.useMutation();
  const updateAmoCRMPipelines = trpc.integrations.updateAmoCRMPipelines.useMutation();
  const updateTelegramReportRecipients = trpc.integrations.updateTelegramReportRecipients.useMutation();
  const sendTelegramTodayReportNow = trpc.integrations.sendTelegramTodayReportNow.useMutation();
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

  useEffect(() => {
    if (!telegramRecipientsQuery.data?.connected) {
      setSelectedTelegramRecipientIds([]);
      return;
    }

    const selected = (telegramRecipientsQuery.data.recipients || [])
      .filter((recipient: TelegramReportRecipient) => recipient.selectedForReports)
      .map((recipient: TelegramReportRecipient) => recipient.chatId);

    setSelectedTelegramRecipientIds(selected);
  }, [telegramRecipientsQuery.data]);

  const handleConnect = async (integrationId: IntegrationId) => {
    setError(null);
    setTelegramSelectionSavedAt(null);
    setTelegramReportSentMessage(null);
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
    setTelegramSelectionSavedAt(null);
    setTelegramReportSentMessage(null);
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
    setTelegramSelectionSavedAt(null);
    setTelegramReportSentMessage(null);
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

  const handleSaveTelegramRecipients = async () => {
    setError(null);
    setActionLoading('telegram');
    setTelegramSelectionSavedAt(null);
    setTelegramReportSentMessage(null);

    try {
      await updateTelegramReportRecipients.mutateAsync({
        chatIds: selectedTelegramRecipientIds,
      });
      await telegramRecipientsQuery.refetch();
      setTelegramSelectionSavedAt(new Date().toISOString());
    } catch (err: any) {
      setError(err?.message || 'Failed to save Telegram report recipients');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendTelegramTodayReportNow = async () => {
    setError(null);
    setActionLoading('telegram');
    setTelegramReportSentMessage(null);

    try {
      const result = await sendTelegramTodayReportNow.mutateAsync();
      const sentAt = new Date().toLocaleTimeString();
      setTelegramReportSentMessage(`Today report sent to ${result.recipientCount} user(s) at ${sentAt}.`);
    } catch (err: any) {
      setError(err?.message || 'Failed to send today report');
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
          const isTelegramActive = integration.id === 'telegram' && integration.status === 'active';
          const telegramRecipients = (telegramRecipientsQuery.data?.recipients || []) as TelegramReportRecipient[];

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

              {isTelegramActive && (
                <div className="mt-4 rounded-md border border-cyan-100 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Scheduled Report Recipients</p>
                      <p className="text-xs text-gray-500">
                        Users appear here after they send <span className="font-mono">/start</span> to your bot. Check who should receive daily/weekly/monthly PDF reports.
                      </p>
                    </div>
                    <span className="text-xs text-gray-500">
                      {selectedTelegramRecipientIds.length}/{telegramRecipients.length} selected
                    </span>
                  </div>

                  {telegramRecipientsQuery.isLoading ? (
                    <p className="mt-3 text-sm text-gray-500">Loading Telegram users...</p>
                  ) : telegramRecipients.length === 0 ? (
                    <p className="mt-3 text-sm text-gray-500">
                      No users yet. Ask users to open your bot and send <span className="font-mono">/start</span>.
                    </p>
                  ) : (
                    <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                      {telegramRecipients.map((recipient) => (
                        <label
                          key={recipient.chatId}
                          className="flex items-start gap-3 rounded-md border border-gray-100 px-3 py-2 text-sm text-gray-700"
                        >
                          <input
                            type="checkbox"
                            checked={selectedTelegramRecipientIds.includes(recipient.chatId)}
                            onChange={(event) => {
                              setSelectedTelegramRecipientIds((current) => {
                                if (event.target.checked) {
                                  return Array.from(new Set([...current, recipient.chatId]));
                                }
                                return current.filter((chatId) => chatId !== recipient.chatId);
                              });
                            }}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900">{recipient.displayName}</p>
                            <p className="text-xs text-gray-500">
                              Chat ID: {recipient.chatId}
                              {recipient.username ? ` | @${recipient.username}` : ''}
                            </p>
                            {recipient.lastSeenAt && (
                              <p className="text-xs text-gray-500">
                                Last seen: {new Date(recipient.lastSeenAt).toLocaleString()}
                              </p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleSaveTelegramRecipients}
                      disabled={loading || telegramRecipientsQuery.isLoading || telegramRecipients.length === 0}
                      className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? 'Saving...' : 'Save Recipients'}
                    </button>
                    {telegramSelectionSavedAt && (
                      <span className="text-xs text-green-700">
                        Saved at {new Date(telegramSelectionSavedAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleSendTelegramTodayReportNow}
                      disabled={loading || telegramRecipients.length === 0 || selectedTelegramRecipientIds.length === 0}
                      className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? 'Sending...' : 'Send Today Report Now'}
                    </button>
                    {telegramReportSentMessage && (
                      <span className="text-xs text-green-700">{telegramReportSentMessage}</span>
                    )}
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
