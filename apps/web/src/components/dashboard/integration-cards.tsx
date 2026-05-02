'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';

type IntegrationId = 'amocrm' | 'telegram' | 'google_sheets' | 'voip_utel' | 'faceid_attendance';

interface IntegrationConfig {
  webhookUrl?: string | null;
  lastValidatedAt?: string | null;
  connectionMode?: string | null;
  [key: string]: unknown;
}

interface IntegrationListItem {
  type: IntegrationId | string;
  status: string;
  config?: unknown;
  lastSyncAt?: string | null;
}

interface AmoPipelineStatus {
  id?: string;
  name?: string;
}

interface AmoPipeline {
  id: string;
  name: string;
  statuses?: AmoPipelineStatus[];
}

function asIntegrationConfig(value: unknown): IntegrationConfig {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as IntegrationConfig;
  }
  return {};
}

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
  {
    id: 'faceid_attendance',
    name: 'Face ID Davomat',
    description: "Face ID webhook orqali IN/OUT davomat eventlari qabul qilinadi (Bearer token).",
    color: 'bg-rose-50 border-rose-200',
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
  const [faceIdWebhookToken, setFaceIdWebhookToken] = useState('');
  const [faceIdBranchWhitelistInput, setFaceIdBranchWhitelistInput] = useState('');
  const [faceIdUnmatchedPolicy, setFaceIdUnmatchedPolicy] = useState<'store' | 'ignore'>('store');
  const [lastGeneratedFaceIdToken, setLastGeneratedFaceIdToken] = useState<string | null>(null);
  const [faceIdExternalUserId, setFaceIdExternalUserId] = useState('');
  const [faceIdMappedUserId, setFaceIdMappedUserId] = useState('');
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<string[]>([]);
  const [selectedTelegramRecipientIds, setSelectedTelegramRecipientIds] = useState<string[]>([]);
  const [telegramSelectionSavedAt, setTelegramSelectionSavedAt] = useState<string | null>(null);
  const [telegramReportSentMessage, setTelegramReportSentMessage] = useState<string | null>(null);

  const listQuery = trpc.integrations.list.useQuery();
  const integrationsList = useMemo<IntegrationListItem[]>(
    () => (listQuery.data || []) as IntegrationListItem[],
    [listQuery.data],
  );
  const telegramConnected = Boolean(integrationsList.find((it) => it.type === 'telegram' && it.status === 'active'));
  const amoPipelinesQuery = trpc.integrations.getAmoCRMPipelines.useQuery(undefined, {
    enabled: Boolean(integrationsList.find((it) => it.type === 'amocrm' && it.status === 'active')),
    retry: false,
  });
  const telegramRecipientsQuery = trpc.integrations.getTelegramReportRecipients.useQuery(undefined, {
    enabled: telegramConnected,
    retry: false,
  });
  const connectAmoCRM = trpc.integrations.connectAmoCRM.useMutation();
  const connectTelegram = trpc.integrations.connectTelegram.useMutation();
  const connectVoIP = trpc.integrations.connectVoIP.useMutation();
  const connectFaceId = trpc.integrations.connectFaceId.useMutation();
  const updateFaceIdSettings = trpc.integrations.updateFaceIdSettings.useMutation();
  const rotateFaceIdToken = trpc.integrations.rotateFaceIdToken.useMutation();
  const faceIdStatusQuery = trpc.integrations.getFaceIdStatus.useQuery();
  const faceIdMappingsQuery = trpc.integrations.getFaceIdMappings.useQuery();
  const usersQuery = trpc.users.list.useQuery();
  const upsertFaceIdMapping = trpc.integrations.upsertFaceIdMapping.useMutation();
  const removeFaceIdMapping = trpc.integrations.removeFaceIdMapping.useMutation();
  const updateAmoCRMPipelines = trpc.integrations.updateAmoCRMPipelines.useMutation();
  const updateTelegramReportRecipients = trpc.integrations.updateTelegramReportRecipients.useMutation();
  const sendTelegramTodayReportNow = trpc.integrations.sendTelegramTodayReportNow.useMutation();
  const sendTelegramWeeklyReportNow = trpc.integrations.sendTelegramWeeklyReportNow.useMutation();
  const sendTelegramMonthlyReportNow = trpc.integrations.sendTelegramMonthlyReportNow.useMutation();
  const disconnectIntegration = trpc.integrations.disconnect.useMutation();

  const integrations = useMemo(() => {
    return integrationCatalog.map((item) => {
      const connected = integrationsList.find((it) => it.type === item.id);
      return {
        ...item,
        status: connected?.status || 'disconnected',
        config: connected?.config ? asIntegrationConfig(connected.config) : undefined,
        lastSyncAt: connected?.lastSyncAt ?? undefined,
      };
    });
  }, [integrationsList]);

  useEffect(() => {
    if (!amoPipelinesQuery.data) {
      return;
    }

    const availableIds = (amoPipelinesQuery.data.pipelines as AmoPipeline[]).map((pipeline) => pipeline.id);
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

  useEffect(() => {
    if (!faceIdStatusQuery.data) {
      return;
    }

    const whitelist = Array.isArray(faceIdStatusQuery.data.branchWhitelist)
      ? faceIdStatusQuery.data.branchWhitelist.join(', ')
      : '';
    setFaceIdBranchWhitelistInput(whitelist);
    setFaceIdUnmatchedPolicy(faceIdStatusQuery.data.unmatchedUserPolicy === 'ignore' ? 'ignore' : 'store');
  }, [faceIdStatusQuery.data]);

  const handleConnect = async (integrationId: IntegrationId) => {
    setError(null);
    setTelegramSelectionSavedAt(null);
    setTelegramReportSentMessage(null);
    setLastGeneratedFaceIdToken(null);
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

      if (integrationId === 'faceid_attendance') {
        const branchWhitelist = faceIdBranchWhitelistInput
          .split(/[\n,;]+/)
          .map((branch) => branch.trim())
          .filter((branch) => branch.length > 0);

        const result = await connectFaceId.mutateAsync({
          webhookToken: faceIdWebhookToken.trim() || undefined,
          branchWhitelist,
          unmatchedUserPolicy: faceIdUnmatchedPolicy,
        });
        setFaceIdWebhookToken('');
        setLastGeneratedFaceIdToken(result.connection.webhookToken || null);
        await Promise.all([listQuery.refetch(), faceIdStatusQuery.refetch()]);
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
    setLastGeneratedFaceIdToken(null);
    setActionLoading(integrationId);
    try {
      await disconnectIntegration.mutateAsync({ type: integrationId });
      await Promise.all([listQuery.refetch(), faceIdStatusQuery.refetch()]);
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
    setLastGeneratedFaceIdToken(null);

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

  const handleRotateFaceIdToken = async () => {
    setError(null);
    setActionLoading('faceid_attendance');
    try {
      const result = await rotateFaceIdToken.mutateAsync({});
      setLastGeneratedFaceIdToken(result.webhookToken || null);
      await Promise.all([listQuery.refetch(), faceIdStatusQuery.refetch()]);
    } catch (err: any) {
      setError(err?.message || 'Face ID token yangilashda xatolik');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveFaceIdSettings = async () => {
    setError(null);
    setActionLoading('faceid_attendance');
    try {
      const branchWhitelist = faceIdBranchWhitelistInput
        .split(/[\n,;]+/)
        .map((branch) => branch.trim())
        .filter((branch) => branch.length > 0);
      await updateFaceIdSettings.mutateAsync({
        branchWhitelist,
        unmatchedUserPolicy: faceIdUnmatchedPolicy,
      });
      await Promise.all([listQuery.refetch(), faceIdStatusQuery.refetch()]);
    } catch (err: any) {
      setError(err?.message || 'Face ID sozlamalarini saqlashda xatolik');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveFaceIdMapping = async () => {
    setError(null);
    setActionLoading('faceid_attendance');
    try {
      if (!faceIdExternalUserId.trim() || !faceIdMappedUserId) {
        throw new Error('External user ID va foydalanuvchini tanlang.');
      }
      await upsertFaceIdMapping.mutateAsync({
        externalUserId: faceIdExternalUserId.trim(),
        userId: faceIdMappedUserId,
      });
      setFaceIdExternalUserId('');
      setFaceIdMappedUserId('');
      await faceIdMappingsQuery.refetch();
    } catch (err: any) {
      setError(err?.message || 'Face ID mappingni saqlashda xatolik');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveFaceIdMapping = async (externalUserId: string) => {
    setError(null);
    setActionLoading('faceid_attendance');
    try {
      await removeFaceIdMapping.mutateAsync({ externalUserId });
      await faceIdMappingsQuery.refetch();
    } catch (err: any) {
      setError(err?.message || 'Face ID mappingni o‘chirishda xatolik');
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
          const integrationConfig: IntegrationConfig = integration.config || {};
          const webhookUrl = String(integrationConfig.webhookUrl || '');
          const loading = actionLoading === integration.id;
          const pipelines = (amoPipelinesQuery.data?.pipelines || []) as AmoPipeline[];
          const pipelinesErrorMessage = amoPipelinesQuery.error?.message || null;
          const isAmoActive = integration.id === 'amocrm' && integration.status === 'active';
          const isTelegramActive = integration.id === 'telegram' && integration.status === 'active';
          const isFaceIdActive = integration.id === 'faceid_attendance' && integration.status === 'active';
          const faceIdStatus = faceIdStatusQuery.data;
          const faceIdMappings = faceIdMappingsQuery.data?.mappings || [];
          const users = (usersQuery.data || []) as Array<{
            id: string;
            name: string | null;
            username: string | null;
            phone: string | null;
          }>;
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
                  {integrationConfig.lastValidatedAt && (
                    <p>Oxirgi tekshiruv: {new Date(String(integrationConfig.lastValidatedAt)).toLocaleString()}</p>
                  )}
                  {webhookUrl && <p className="break-all">Webhook manzili: {webhookUrl}</p>}
                  {integrationConfig.connectionMode && (
                    <p>Rejim: {String(integrationConfig.connectionMode)}</p>
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
                  ) : pipelinesErrorMessage ? (
                    <div className="mt-3 space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
                      <p className="text-sm text-red-700">{pipelinesErrorMessage}</p>
                      <button
                        type="button"
                        onClick={() => amoPipelinesQuery.refetch()}
                        disabled={amoPipelinesQuery.isFetching}
                        className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {amoPipelinesQuery.isFetching ? 'Qayta urinilmoqda...' : 'Qayta urinish'}
                      </button>
                    </div>
                  ) : pipelines.length === 0 ? (
                    <p className="mt-3 text-sm text-gray-500">AmoCRM dan pipeline ma'lumoti kelmadi.</p>
                  ) : (
                    <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                      {pipelines.map((pipeline) => (
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
                                Bosqichlar: {pipeline.statuses.map((status) => status.name).join(', ')}
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
                      disabled={loading || amoPipelinesQuery.isLoading || !!pipelinesErrorMessage}
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

              {isFaceIdActive && (
                <div className="mt-4 rounded-md border border-rose-100 bg-white p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Face ID webhook sozlamasi</p>
                      <p className="text-xs text-gray-500">
                        Bearer token bilan <span className="font-mono">POST /webhooks/faceid</span> endpointiga yuboriladi.
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1 text-xs text-gray-600">
                    <p className="break-all">
                      Webhook: {String(faceIdStatus?.webhookUrl || integrationConfig.webhookUrl || '')}
                    </p>
                    <p>Token holati: {faceIdStatus?.hasToken ? 'Mavjud' : 'Yo‘q'}</p>
                    {!faceIdStatus?.hasToken && (
                      <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                        Token topilmadi. Avval <b>Tokenni yangilash</b> tugmasini bosing va shu tokenni Face ID yuboruvchi tizimga kiriting.
                      </p>
                    )}
                    <p>Mos kelmagan foydalanuvchi rejimi: {faceIdStatus?.unmatchedUserPolicy === 'ignore' ? 'Ignore' : 'Store'}</p>
                    {Array.isArray(faceIdStatus?.branchWhitelist) && faceIdStatus.branchWhitelist.length > 0 && (
                      <p>Ruxsat etilgan filiallar: {faceIdStatus.branchWhitelist.join(', ')}</p>
                    )}
                    {faceIdStatus?.lastSyncAt && (
                      <p>Oxirgi sinxron: {new Date(faceIdStatus.lastSyncAt).toLocaleString()}</p>
                    )}
                    {lastGeneratedFaceIdToken && (
                      <p className="break-all rounded border border-rose-200 bg-rose-50 px-2 py-1 text-rose-800">
                        Yangi token: <span className="font-mono">{lastGeneratedFaceIdToken}</span>
                      </p>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded border border-rose-100 bg-rose-50 p-2 text-xs text-rose-900">
                      <p>Kutilayotgan webhook: {Number(faceIdStatus?.health?.webhookPending || 0)}</p>
                      <p>24 soat xatolik: {Number(faceIdStatus?.health?.webhookFailedLast24h || 0)}</p>
                      <p>24 soat processed: {Number(faceIdStatus?.health?.webhookProcessedLast24h || 0)}</p>
                    </div>
                    <div className="rounded border border-rose-100 bg-rose-50 p-2 text-xs text-rose-900">
                      <p>7 kun eventlar: {Number(faceIdStatus?.health?.eventsLast7d || 0)}</p>
                      <p>7 kun matched: {Number(faceIdStatus?.health?.matchedEventsLast7d || 0)}</p>
                      <p>7 kun unmatched: {Number(faceIdStatus?.health?.unmatchedEventsLast7d || 0)}</p>
                    </div>
                  </div>

                  {Array.isArray(faceIdStatus?.recentWebhookErrors) && faceIdStatus.recentWebhookErrors.length > 0 && (
                    <div className="mt-3 rounded border border-red-200 bg-red-50 p-2">
                      <p className="text-xs font-semibold text-red-700">Oxirgi webhook xatolari</p>
                      <div className="mt-1 space-y-1 text-xs text-red-700">
                        {faceIdStatus.recentWebhookErrors.map((row: any) => (
                          <p key={row.id}>
                            {new Date(row.createdAt).toLocaleString()} - {row.eventType}: {String(row.errorMessage || '')}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 space-y-2 rounded-md border border-rose-100 bg-white p-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Mos kelmagan user hodisalari</label>
                      <select
                        value={faceIdUnmatchedPolicy}
                        onChange={(e) => setFaceIdUnmatchedPolicy(e.target.value === 'ignore' ? 'ignore' : 'store')}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                      >
                        <option value="store">Store (anomalies uchun saqlash)</option>
                        <option value="ignore">Ignore (saqlamaslik)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Filiallar ro'yxati (ixtiyoriy)</label>
                      <input
                        type="text"
                        value={faceIdBranchWhitelistInput}
                        onChange={(e) => setFaceIdBranchWhitelistInput(e.target.value)}
                        placeholder="Masalan: Labzak, Chilonzor"
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveFaceIdSettings}
                      disabled={loading}
                      className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? 'Saqlanmoqda...' : 'Face ID sozlamalarini saqlash'}
                    </button>
                  </div>

                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={handleRotateFaceIdToken}
                      disabled={loading}
                      className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? 'Yangilanmoqda...' : 'Tokenni yangilash'}
                    </button>
                  </div>

                  <div className="mt-3 space-y-2 rounded-md border border-rose-100 bg-white p-3">
                    <p className="text-sm font-medium text-gray-900">Face ID user mapping</p>
                    <p className="text-xs text-gray-500">
                      Match order: telefon -&gt; external ID -&gt; to‘liq ism. External ID mapping faqat 2-qadamda ishlatiladi.
                    </p>

                    <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
                      <input
                        type="text"
                        value={faceIdExternalUserId}
                        onChange={(e) => setFaceIdExternalUserId(e.target.value)}
                        placeholder="External user ID (masalan: 2845)"
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                      />
                      <select
                        value={faceIdMappedUserId}
                        onChange={(e) => setFaceIdMappedUserId(e.target.value)}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                      >
                        <option value="">Foydalanuvchini tanlang</option>
                        {users.map((user) => (
                          <option key={user.id} value={user.id}>
                            {(user.name || user.username || user.id)}{user.phone ? ` (${user.phone})` : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleSaveFaceIdMapping}
                        disabled={loading}
                        className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {loading ? 'Saqlanmoqda...' : 'Mapping saqlash'}
                      </button>
                    </div>

                    <div className="max-h-56 overflow-auto rounded-md border border-gray-200">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">External ID</th>
                            <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">User</th>
                            <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">Telefon</th>
                            <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">Holat</th>
                            <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">Amal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                          {faceIdMappings.map((row: any) => (
                            <tr key={row.externalUserId}>
                              <td className="px-2 py-2 text-xs text-gray-700">{row.externalUserId}</td>
                              <td className="px-2 py-2 text-xs text-gray-700">{row.userName || row.userId}</td>
                              <td className="px-2 py-2 text-xs text-gray-700">{row.userPhone || '-'}</td>
                              <td className="px-2 py-2 text-xs text-gray-700">{row.userActive ? 'Faol' : 'No-faol'}</td>
                              <td className="px-2 py-2 text-xs">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveFaceIdMapping(String(row.externalUserId))}
                                  disabled={loading}
                                  className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700 hover:bg-red-100 disabled:opacity-50"
                                >
                                  O‘chirish
                                </button>
                              </td>
                            </tr>
                          ))}
                          {!faceIdMappings.length && (
                            <tr>
                              <td colSpan={5} className="px-2 py-3 text-center text-xs text-gray-500">
                                Hozircha external ID mappinglar yo‘q.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
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

              {integration.id === 'faceid_attendance' && integration.status === 'disconnected' && (
                <div className="mt-4 space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Webhook token (ixtiyoriy)</label>
                    <input
                      type="text"
                      value={faceIdWebhookToken}
                      onChange={(e) => setFaceIdWebhookToken(e.target.value)}
                      placeholder="Bo'sh qoldirilsa token avtomatik yaratiladi"
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Filiallar ro'yxati (ixtiyoriy)</label>
                    <input
                      type="text"
                      value={faceIdBranchWhitelistInput}
                      onChange={(e) => setFaceIdBranchWhitelistInput(e.target.value)}
                      placeholder="Masalan: Labzak, Chilonzor"
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Mos kelmagan user hodisalari</label>
                    <select
                      value={faceIdUnmatchedPolicy}
                      onChange={(e) => setFaceIdUnmatchedPolicy(e.target.value === 'ignore' ? 'ignore' : 'store')}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="store">Store (anomalies uchun saqlash)</option>
                      <option value="ignore">Ignore (saqlamaslik)</option>
                    </select>
                  </div>
                  {lastGeneratedFaceIdToken && (
                    <p className="break-all rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800">
                      Yaratilgan token: <span className="font-mono">{lastGeneratedFaceIdToken}</span>
                    </p>
                  )}
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
                    {loading
                      ? "Ulanmoqda..."
                      : integration.id === 'google_sheets'
                        ? "O'chirilgan"
                        : integration.id === 'amocrm'
                          ? 'Token orqali ulash'
                          : integration.id === 'faceid_attendance'
                            ? 'Webhookni ulash'
                            : 'Ulash'}
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
