'use client';

import type { IntegrationType as IntegrationId } from '@dashboarduz/shared';
import type { useIntegrationCardsState } from './use-integration-cards-state';

export function useIntegrationCardsActions(base: ReturnType<typeof useIntegrationCardsState>) {
  const { amoPipelinesQuery, amocrmBaseUrl, amocrmLongLivedToken, connectAmoCRM, connectFaceId, connectTelegram, connectVoIP, disconnectIntegration, faceIdBranchWhitelistInput, faceIdExternalUserId, faceIdMappedUserId, faceIdMappingsQuery, faceIdStatusQuery, faceIdUnmatchedPolicy, faceIdWebhookToken, listQuery, removeFaceIdMapping, repairTelegramWebhook, rotateFaceIdToken, selectedPipelineIds, selectedTelegramDailyCourseIds, selectedTelegramRecipientIds, sendTelegramGroupSummaryNow, sendTelegramMonthlyReportNow, sendTelegramTodayReportNow, sendTelegramWeeklyReportNow, setActionLoading, setAmocrmBaseUrl, setAmocrmLongLivedToken, setError, setFaceIdExternalUserId, setFaceIdMappedUserId, setFaceIdWebhookToken, setLastGeneratedFaceIdToken, setTelegramReportSentMessage, setTelegramSelectionSavedAt, setTelegramToken, telegramHealthQuery, telegramRecipientsQuery, telegramToken, updateAmoCRMPipelines, updateFaceIdSettings, updateTelegramReportRecipients, upsertFaceIdMapping } = base;

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
        dailyReportCourseIds: selectedTelegramDailyCourseIds.filter(Boolean).slice(0, 3),
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
  const handleRepairTelegramWebhook = async () => {
    setError(null);
    setActionLoading('telegram');
    setTelegramReportSentMessage(null);
    try {
      await repairTelegramWebhook.mutateAsync();
      await Promise.all([telegramHealthQuery.refetch(), telegramRecipientsQuery.refetch()]);
      setTelegramReportSentMessage("Webhook qayta ulandi. Endi botga /start yuborib ko'ring.");
    } catch (err: any) {
      setError(err?.message || 'Telegram webhookni qayta ulashda xatolik');
    } finally {
      setActionLoading(null);
    }
  };
  const handleSendTelegramGroupSummaryNow = async () => {
    setError(null);
    setActionLoading('telegram');
    setTelegramReportSentMessage(null);
    try {
      const result = await sendTelegramGroupSummaryNow.mutateAsync();
      const summary = result.results.map((item) => {
        const group = item.group === 'online' ? 'Online' : 'Offline';
        if (item.status === 'sent') return `${group}: ${item.sentCount}/${item.destinationCount} yuborildi`;
        if (item.status === 'skipped') return `${group}: o'tkazib yuborildi (${item.error || 'sozlanmagan'})`;
        return `${group}: xatolik (${item.sentCount}/${item.destinationCount})`;
      }).join(' · ');
      setTelegramReportSentMessage(`Bugungi guruh hisoboti: ${summary}.`);
    } catch (err: any) {
      setError(err?.message || 'Guruh hisobotini yuborishda xatolik');
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

  return { ...base, handleConnect, handleDisconnect, handleSavePipelines, handleSaveTelegramRecipients, handleRotateFaceIdToken, handleSaveFaceIdSettings, handleSaveFaceIdMapping, handleRemoveFaceIdMapping, handleSendTelegramTodayReportNow, handleRepairTelegramWebhook, handleSendTelegramGroupSummaryNow, handleSendTelegramWeeklyReportNow, handleSendTelegramMonthlyReportNow };
}
