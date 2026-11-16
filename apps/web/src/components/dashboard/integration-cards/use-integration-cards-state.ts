'use client';

import { trpc } from '@/lib/trpc';
import type { IntegrationType as IntegrationId } from '@dashboarduz/shared';
import { useEffect, useMemo, useState } from 'react';
import { type AmoPipeline, asIntegrationConfig, integrationCatalog, type IntegrationListItem, type TelegramReportRecipient } from './integration-helpers';

export function useIntegrationCardsState() {
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
  const [selectedTelegramDailyCourseIds, setSelectedTelegramDailyCourseIds] = useState<string[]>([]);
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
    refetchInterval: 15_000,
  });
  const telegramHealthQuery = trpc.integrations.getTelegramHealth.useQuery(undefined, {
    enabled: telegramConnected,
    retry: false,
    refetchInterval: 15_000,
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
  const repairTelegramWebhook = trpc.integrations.repairTelegramWebhook.useMutation();
  const sendTelegramTodayReportNow = trpc.integrations.sendTelegramTodayReportNow.useMutation();
  const sendTelegramGroupSummaryNow = trpc.integrations.sendTelegramGroupSummaryNow.useMutation();
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
      setSelectedTelegramDailyCourseIds([]);
      return;
    }

    const selected = (telegramRecipientsQuery.data.recipients || [])
      .filter((recipient: TelegramReportRecipient) => recipient.selectedForReports)
      .map((recipient: TelegramReportRecipient) => recipient.chatId);

    setSelectedTelegramRecipientIds(selected);
    setSelectedTelegramDailyCourseIds(
      Array.isArray(telegramRecipientsQuery.data.selectedDailyReportCourseIds)
        ? telegramRecipientsQuery.data.selectedDailyReportCourseIds.slice(0, 3)
        : [],
    );
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

  return { error, setError, actionLoading, setActionLoading, amocrmLongLivedToken, setAmocrmLongLivedToken, amocrmBaseUrl, setAmocrmBaseUrl, telegramToken, setTelegramToken, faceIdWebhookToken, setFaceIdWebhookToken, faceIdBranchWhitelistInput, setFaceIdBranchWhitelistInput, faceIdUnmatchedPolicy, setFaceIdUnmatchedPolicy, lastGeneratedFaceIdToken, setLastGeneratedFaceIdToken, faceIdExternalUserId, setFaceIdExternalUserId, faceIdMappedUserId, setFaceIdMappedUserId, selectedPipelineIds, setSelectedPipelineIds, selectedTelegramRecipientIds, setSelectedTelegramRecipientIds, selectedTelegramDailyCourseIds, setSelectedTelegramDailyCourseIds, telegramSelectionSavedAt, setTelegramSelectionSavedAt, telegramReportSentMessage, setTelegramReportSentMessage, listQuery, integrationsList, telegramConnected, amoPipelinesQuery, telegramRecipientsQuery, telegramHealthQuery, connectAmoCRM, connectTelegram, connectVoIP, connectFaceId, updateFaceIdSettings, rotateFaceIdToken, faceIdStatusQuery, faceIdMappingsQuery, usersQuery, upsertFaceIdMapping, removeFaceIdMapping, updateAmoCRMPipelines, updateTelegramReportRecipients, repairTelegramWebhook, sendTelegramTodayReportNow, sendTelegramGroupSummaryNow, sendTelegramWeeklyReportNow, sendTelegramMonthlyReportNow, disconnectIntegration, integrations };
}
