'use client';

import type { AmoPipeline, IntegrationConfig, TelegramReportCourseOption, TelegramReportRecipient } from './integration-helpers';
import type { IntegrationCardsModel } from './use-integration-cards';

export function useIntegrationCardState({ vm, integration }: { vm: IntegrationCardsModel; integration: IntegrationCardsModel['integrations'][number] }) {
  const { actionLoading, amoPipelinesQuery, amocrmBaseUrl, amocrmLongLivedToken, faceIdBranchWhitelistInput, faceIdExternalUserId, faceIdMappedUserId, faceIdMappingsQuery, faceIdStatusQuery, faceIdUnmatchedPolicy, faceIdWebhookToken, handleConnect, handleDisconnect, handleRemoveFaceIdMapping, handleRepairTelegramWebhook, handleRotateFaceIdToken, handleSaveFaceIdMapping, handleSaveFaceIdSettings, handleSavePipelines, handleSaveTelegramRecipients, handleSendTelegramGroupSummaryNow, handleSendTelegramMonthlyReportNow, handleSendTelegramTodayReportNow, handleSendTelegramWeeklyReportNow, integrations, lastGeneratedFaceIdToken, selectedPipelineIds, selectedTelegramDailyCourseIds, selectedTelegramRecipientIds, setAmocrmBaseUrl, setAmocrmLongLivedToken, setFaceIdBranchWhitelistInput, setFaceIdExternalUserId, setFaceIdMappedUserId, setFaceIdUnmatchedPolicy, setFaceIdWebhookToken, setSelectedPipelineIds, setSelectedTelegramDailyCourseIds, setSelectedTelegramRecipientIds, setTelegramToken, telegramHealthQuery, telegramRecipientsQuery, telegramReportSentMessage, telegramSelectionSavedAt, telegramToken, usersQuery } = vm;
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
  const telegramCourseOptions = (telegramRecipientsQuery.data?.courseOptions || []) as TelegramReportCourseOption[];
  const recipientStorageReady = telegramRecipientsQuery.data?.recipientStorageReady !== false;

  return { vm, integration, actionLoading, amoPipelinesQuery, amocrmBaseUrl, amocrmLongLivedToken, faceIdBranchWhitelistInput, faceIdExternalUserId, faceIdMappedUserId, faceIdMappingsQuery, faceIdStatusQuery, faceIdUnmatchedPolicy, faceIdWebhookToken, handleConnect, handleDisconnect, handleRemoveFaceIdMapping, handleRepairTelegramWebhook, handleRotateFaceIdToken, handleSaveFaceIdMapping, handleSaveFaceIdSettings, handleSavePipelines, handleSaveTelegramRecipients, handleSendTelegramGroupSummaryNow, handleSendTelegramMonthlyReportNow, handleSendTelegramTodayReportNow, handleSendTelegramWeeklyReportNow, integrations, lastGeneratedFaceIdToken, selectedPipelineIds, selectedTelegramDailyCourseIds, selectedTelegramRecipientIds, setAmocrmBaseUrl, setAmocrmLongLivedToken, setFaceIdBranchWhitelistInput, setFaceIdExternalUserId, setFaceIdMappedUserId, setFaceIdUnmatchedPolicy, setFaceIdWebhookToken, setSelectedPipelineIds, setSelectedTelegramDailyCourseIds, setSelectedTelegramRecipientIds, setTelegramToken, telegramHealthQuery, telegramRecipientsQuery, telegramReportSentMessage, telegramSelectionSavedAt, telegramToken, usersQuery, integrationConfig, webhookUrl, loading, pipelines, pipelinesErrorMessage, isAmoActive, isTelegramActive, isFaceIdActive, faceIdStatus, faceIdMappings, users, telegramRecipients, telegramCourseOptions, recipientStorageReady };
}
