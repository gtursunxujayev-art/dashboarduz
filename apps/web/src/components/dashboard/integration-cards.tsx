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
    description: "Uzoq muddatli token orqali ulanadi: lid/contact sinxroni va webhook qabul qilish.",
    color: 'bg-blue-50 border-blue-200',
  },
  {
    id: 'telegram',
    name: 'Telegram Bot',
    description: "Bot token ulanadi, webhook avtomatik ro'yxatdan o'tadi va xabar yuboradi.",
    color: 'bg-cyan-50 border-cyan-200',
  },
  {
    id: 'google_sheets',
    name: 'Google Sheets',
    description: "MVP uchun vaqtincha o'chirilgan.",
    color: 'bg-gray-50 border-gray-200',
  },
  {
    id: 'voip_utel',
    name: 'VoIP (Webhook)',
    description: "Faqat webhook rejimi: UTeL va boshqa operatorlardan qo'ng'iroqlar qabul qilinadi.",
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
      return 'Ulangan';
    case 'pending':
      return 'Kutilmoqda';
    case 'error':
      return 'Xatolik';
    default:
      return 'Ulanmagan';
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
  const sendTelegramWeeklyReportNow = trpc.integrations.sendTelegramWeeklyReportNow.useMutation();
  const sendTelegramMonthlyReportNow = trpc.integrations.sendTelegramMonthlyReportNow.useMutation();
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
          throw new Error("AmoCRM uzoq muddatli tokeni majburiy");
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
          throw new Error('Telegram bot token majburiy');
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

      setError("Google Sheets integratsiyasi MVP da o'chirilgan");
    } catch (err: any) {
      setError(err?.message || `${integrationId} ulanishida xatolik`);
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
      setError(err?.message || `${integrationId} uzishda xatolik`);
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
      setError(err?.message || 'AmoCRM pipeline saqlashda xatolik');
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
      setError(err?.message || 'Telegram hisobot oluvchilarini saqlashda xatolik');
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
      setTelegramReportSentMessage(`Bugungi hisobot ${result.recipientCount} ta foydalanuvchiga ${sentAt} da yuborildi.`);
    } catch (err: any) {
      setError(err?.message || 'Bugungi hisobotni yuborishda xatolik');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendTelegramWeeklyReportNow = async () => {
    setError(null);
    setActionLoading('telegram');
    setTelegramReportSentMessage(null);

    try {
      const result = await sendTelegramWeeklyReportNow.mutateAsync();
      const sentAt = new Date().toLocaleTimeString();
      setTelegramReportSentMessage(`Haftalik hisobot ${result.recipientCount} ta foydalanuvchiga ${sentAt} da yuborildi.`);
    } catch (err: any) {
      setError(err?.message || 'Haftalik hisobotni yuborishda xatolik');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendTelegramMonthlyReportNow = async () => {
    setError(null);
    setActionLoading('telegram');
    setTelegramReportSentMessage(null);

    try {
      const result = await sendTelegramMonthlyReportNow.mutateAsync();
      const sentAt = new Date().toLocaleTimeString();
      setTelegramReportSentMessage(`Oylik hisobot ${result.recipientCount} ta foydalanuvchiga ${sentAt} da yuborildi.`);
    } catch (err: any) {
      setError(err?.message || 'Oylik hisobotni yuborishda xatolik');
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
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="text-base font-semibold text-gray-900">{integration.name}</h4>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge(integration.status)}`}>
                  {statusText(integration.status)}
                </span>
              </div>

              <p className="mt-1 text-sm text-gray-600">{integration.description}</p>

              {integration.status === 'active' && (
                <div className="mt-3 space-y-1 text-xs text-gray-600">
                  {integration.lastSyncAt && <p>Oxirgi sinxron: {new Date(integration.lastSyncAt).toLocaleString()}</p>}
                  {(integrationConfig as any).lastValidatedAt && (
                    <p>Oxirgi tekshiruv: {new Date(String((integrationConfig as any).lastValidatedAt)).toLocaleString()}</p>
                  )}
                  {webhookUrl && <p className="break-all">Webhook manzili: {webhookUrl}</p>}
                  {(integrationConfig as any).connectionMode && (
                    <p>Rejim: {String((integrationConfig as any).connectionMode)}</p>
                  )}
                </div>
              )}

              {isAmoActive && (
                <div className="mt-4 rounded-md border border-blue-100 bg-white p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Jonli o'qishda ishlatiladigan pipeline'lar</p>
                      <p className="text-xs text-gray-500">
                        Boshqaruv tahlili va webhook orqali qabul qilishda faqat belgilangan pipeline'lar ishlatiladi.
                      </p>
                    </div>
                    <span className="text-xs text-gray-500">
                      {selectedPipelineIds.length}/{pipelines.length} ta tanlangan
                    </span>
                  </div>

                  {amoPipelinesQuery.isLoading ? (
                    <p className="mt-3 text-sm text-gray-500">Pipeline'lar yuklanmoqda...</p>
                  ) : pipelines.length === 0 ? (
                    <p className="mt-3 text-sm text-gray-500">AmoCRM dan pipeline ma'lumoti kelmadi.</p>
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
                                Bosqichlar: {pipeline.statuses.map((status: any) => status.name).join(', ')}
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
                      {loading ? 'Saqlanmoqda...' : "Pipeline tanlovini saqlash"}
                    </button>
                  </div>
                </div>
              )}

              {isTelegramActive && (
                <div className="mt-4 rounded-md border border-cyan-100 bg-white p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Rejalashtirilgan hisobot oluvchilari</p>
                      <p className="text-xs text-gray-500">
                        Foydalanuvchilar botga <span className="font-mono">/start</span> yuborgandan keyin shu yerda ko'rinadi. Kunlik/haftalik/oylik hisobot oluvchilarni belgilang.
                      </p>
                    </div>
                    <span className="text-xs text-gray-500">
                      {selectedTelegramRecipientIds.length}/{telegramRecipients.length} ta tanlangan
                    </span>
                  </div>

                  {telegramRecipientsQuery.isLoading ? (
                    <p className="mt-3 text-sm text-gray-500">Telegram foydalanuvchilari yuklanmoqda...</p>
                  ) : telegramRecipients.length === 0 ? (
                    <p className="mt-3 text-sm text-gray-500">
                      Hozircha foydalanuvchi yo'q. Foydalanuvchilardan botni ochib <span className="font-mono">/start</span> yuborishni so'rang.
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
                                Oxirgi faollik: {new Date(recipient.lastSeenAt).toLocaleString()}
                              </p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleSaveTelegramRecipients}
                      disabled={loading || telegramRecipientsQuery.isLoading || telegramRecipients.length === 0}
                      className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? 'Saqlanmoqda...' : 'Qabul qiluvchilarni saqlash'}
                    </button>
                    {telegramSelectionSavedAt && (
                      <span className="text-xs text-green-700">
                        Saqlandi: {new Date(telegramSelectionSavedAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleSendTelegramTodayReportNow}
                      disabled={loading || telegramRecipients.length === 0 || selectedTelegramRecipientIds.length === 0}
                      className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? 'Yuborilmoqda...' : 'Bugungi hisobotni hozir yuborish'}
                    </button>
                    <button
                      type="button"
                      onClick={handleSendTelegramWeeklyReportNow}
                      disabled={loading || telegramRecipients.length === 0 || selectedTelegramRecipientIds.length === 0}
                      className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? 'Yuborilmoqda...' : 'Haftalik hisobotni yuborish'}
                    </button>
                    <button
                      type="button"
                      onClick={handleSendTelegramMonthlyReportNow}
                      disabled={loading || telegramRecipients.length === 0 || selectedTelegramRecipientIds.length === 0}
                      className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-800 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? 'Yuborilmoqda...' : 'Oylik hisobotni yuborish'}
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
                    <label className="block text-xs font-medium text-gray-700">AmoCRM uzoq muddatli tokeni</label>
                    <input
                      type="password"
                      value={amocrmLongLivedToken}
                      onChange={(e) => setAmocrmLongLivedToken(e.target.value)}
                      placeholder="Uzoq muddatli token"
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">AmoCRM asosiy manzil (ixtiyoriy)</label>
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
                  <label className="block text-xs font-medium text-gray-700">Telegram bot token</label>
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
                    {loading ? "Ulanmoqda..." : integration.id === 'google_sheets' ? "O'chirilgan" : integration.id === 'amocrm' ? 'Token orqali ulash' : 'Ulash'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleDisconnect(integration.id)}
                    disabled={loading}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? 'Yangilanmoqda...' : 'Uzish'}
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


