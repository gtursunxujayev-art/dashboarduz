import { prisma } from '@dashboarduz/db';
import { queueService } from '../services/queue';
import { log, LogLevel } from '../services/observability';
import { telegramService } from '../services/integrations/telegram';
import { decryptIntegrationTokens } from '../services/security/encryption';
import { rateLimiter } from '../services/security/rate-limiter';
import { asObject, getSelectedPipelineIds } from '../services/integrations/amocrm-live';

function normalizePhone(phone?: string | null): string {
  if (!phone) {
    return '';
  }
  return phone.replace(/[^\d+]/g, '');
}

function extractAmoEntities(payload: any, key: 'leads' | 'contacts'): any[] {
  const direct = payload?.[key];
  if (Array.isArray(direct)) {
    return direct;
  }

  const add = payload?.[key]?.add;
  if (Array.isArray(add)) {
    return add;
  }

  const embedded = payload?._embedded?.[key];
  if (Array.isArray(embedded)) {
    return embedded;
  }

  return [];
}

function extractContactField(contactData: any, code: string): string | null {
  const fields = Array.isArray(contactData?.custom_fields_values)
    ? contactData.custom_fields_values
    : [];

  const field = fields.find((item: any) => String(item?.field_code || item?.code || '').toUpperCase() === code);
  const value = field?.values?.[0]?.value;
  return typeof value === 'string' ? value : null;
}

function parseAmoTimestamp(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber)) {
      return parseAmoTimestamp(asNumber);
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function parseCallDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber)) {
      return parseCallDate(asNumber);
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

type NormalizedVoipCall = {
  callIdExternal: string;
  from: string;
  to: string;
  direction: 'inbound' | 'outbound';
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  duration: number | null;
  recordingUrl: string | null;
  recordingId: string | null;
  metadata: Record<string, unknown>;
};

function normalizeDirection(value: unknown): 'inbound' | 'outbound' {
  const normalized = String(value || '').trim().toLowerCase();
  if (['out', 'outbound', 'dial_out', 'outgoing'].includes(normalized)) {
    return 'outbound';
  }
  return 'inbound';
}

function parseDurationSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return null;
}

function extractVoipCallEntries(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const candidates: unknown[] = [
    payload.call,
    payload.event,
    payload.data,
    payload.recentCalls,
    payload.calls,
    payload.call_events,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object',
      );
    }

    if (candidate && typeof candidate === 'object') {
      return [candidate as Record<string, unknown>];
    }
  }

  return [payload];
}

function normalizeVoipCall(entry: Record<string, unknown>, fallbackCallId: string): NormalizedVoipCall {
  const direction = normalizeDirection(entry.direction);

  const phone = normalizePhone(String(entry.phone || entry.client_phone || entry.customer_phone || ''));
  const extension = normalizePhone(String(entry.extension || entry.ext || entry.internal || ''));
  const from = normalizePhone(
    String(entry.from || entry.caller || (direction === 'outbound' ? extension : phone) || ''),
  );
  const to = normalizePhone(
    String(entry.to || entry.callee || (direction === 'outbound' ? phone : extension) || ''),
  );

  const startedAt = parseCallDate(
    entry.start_time || entry.started_at || entry.startedAt || entry.date || entry.created_at,
  ) || new Date();
  const endedAt = parseCallDate(entry.end_time || entry.ended_at || entry.endedAt);
  const parsedDuration = parseDurationSeconds(entry.duration);
  const duration = parsedDuration ?? (endedAt
    ? Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000))
    : null);

  const callIdExternal = String(
    entry.call_id || entry.id || entry.uuid || entry.uniqueid || fallbackCallId,
  );

  return {
    callIdExternal,
    from,
    to,
    direction,
    status: String(entry.status || entry.call_status || 'completed'),
    startedAt,
    endedAt,
    duration,
    recordingUrl: entry.recording_url ? String(entry.recording_url) : null,
    recordingId: entry.recording_id ? String(entry.recording_id) : null,
    metadata: entry,
  };
}

export async function processWebhookEvent(eventId: string) {
  let tenantIdForAudit: string | null = null;

  try {
    log(LogLevel.INFO, 'Processing webhook event', { eventId });
    const event = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new Error(`Webhook event ${eventId} not found`);
    }

    if (event.processed) {
      log(LogLevel.WARN, 'Webhook event already processed', { eventId });
      return;
    }

    let tenantId = event.tenantId;
    if (!tenantId && event.source === 'amocrm') {
      const accountId = (event.rawPayload as any)?.account?.id ?? (event.rawPayload as any)?.account_id;
      if (accountId) {
        const integration = await prisma.integration.findFirst({
          where: {
            type: 'amocrm',
            config: {
              path: ['account_id'],
              equals: String(accountId),
            },
          },
        });
        tenantId = integration?.tenantId || null;
      }
    }

    if (!tenantId) {
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: {
          processed: true,
          errorMessage: 'Cannot determine tenant',
        },
      });
      return;
    }

    tenantIdForAudit = tenantId;

    switch (event.source) {
      case 'amocrm':
        await processAmoCRMWebhook(event, tenantId);
        break;
      case 'voip':
      case 'utel':
        await processVoIPWebhook(event, tenantId);
        break;
      case 'telegram':
        await processTelegramWebhook(event, tenantId);
        break;
      default:
        log(LogLevel.WARN, 'Unknown webhook source', { eventId, source: event.source });
    }

    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        processed: true,
        processedAt: new Date(),
        errorMessage: null,
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        action: 'webhook_processed',
        resource: 'webhook',
        resourceId: eventId,
        metadata: { source: event.source, eventType: event.eventType },
      },
    });
  } catch (error: any) {
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        errorMessage: error.message,
        retryCount: { increment: 1 },
      },
    });

    if (tenantIdForAudit) {
      await prisma.auditLog.create({
        data: {
          tenantId: tenantIdForAudit,
          action: 'webhook_failed',
          resource: 'webhook',
          resourceId: eventId,
          metadata: { error: error.message },
        },
      });
    }

    log(LogLevel.ERROR, 'Webhook processing failed', {
      eventId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

async function processAmoCRMWebhook(event: any, tenantId: string) {
  const payload = event.rawPayload as any;
  const leads = extractAmoEntities(payload, 'leads');
  const contacts = extractAmoEntities(payload, 'contacts');
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_type: {
        tenantId,
        type: 'amocrm',
      },
    },
    select: {
      config: true,
    },
  });
  const selectedPipelineIds = getSelectedPipelineIds(integration?.config);

  for (const leadData of leads) {
    const leadId = leadData?.id ? String(leadData.id) : null;
    if (!leadId) {
      continue;
    }

    const pipelineId = leadData?.pipeline_id ? String(leadData.pipeline_id) : null;
    if (selectedPipelineIds && (!pipelineId || !selectedPipelineIds.includes(pipelineId))) {
      continue;
    }

    const externalCreatedAt = parseAmoTimestamp(leadData.created_at);
    const externalUpdatedAt = parseAmoTimestamp(leadData.updated_at);

    await prisma.lead.upsert({
      where: {
        tenantId_amocrmId: {
          tenantId,
          amocrmId: leadId,
        },
      },
      update: {
        title: leadData.name || 'Untitled Lead',
        status: leadData.status_id ? String(leadData.status_id) : null,
        pipelineId,
        responsibleUserId: leadData.responsible_user_id ? String(leadData.responsible_user_id) : null,
        metadata: leadData,
        source: 'amocrm',
        externalCreatedAt,
        externalUpdatedAt,
        updatedAt: new Date(),
      },
      create: {
        tenantId,
        amocrmId: leadId,
        title: leadData.name || 'Untitled Lead',
        status: leadData.status_id ? String(leadData.status_id) : null,
        pipelineId,
        responsibleUserId: leadData.responsible_user_id ? String(leadData.responsible_user_id) : null,
        metadata: leadData,
        source: 'amocrm',
        externalCreatedAt,
        externalUpdatedAt,
      },
    });
  }

  for (const contactData of contacts) {
    const phone = extractContactField(contactData, 'PHONE') || contactData.phone?.[0]?.value || null;
    const email = extractContactField(contactData, 'EMAIL') || contactData.email?.[0]?.value || null;
    const name = contactData.name || null;

    const existingContact = await prisma.contact.findFirst({
      where: {
        tenantId,
        OR: [
          ...(phone ? [{ phone }] : []),
          ...(email ? [{ email }] : []),
        ],
      },
    });

    if (existingContact) {
      const existingExternalIds = (existingContact.externalIds as Record<string, unknown> | null) || {};
      await prisma.contact.update({
        where: { id: existingContact.id },
        data: {
          name: name || existingContact.name,
          phone: phone || existingContact.phone,
          email: email || existingContact.email,
          externalIds: {
            ...existingExternalIds,
            amocrm_id: String(contactData.id),
          },
          metadata: contactData,
        },
      });
    } else {
      await prisma.contact.create({
        data: {
          tenantId,
          name,
          phone,
          email,
          externalIds: { amocrm_id: String(contactData.id) },
          metadata: contactData,
        },
      });
    }
  }

  const [telegramIntegration, tenant] = await Promise.all([
    prisma.integration.findFirst({
      where: { tenantId, type: 'telegram', status: 'active' },
    }),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    }),
  ]);
  const chatId = String(((tenant?.settings as any)?.notificationChatId || '')).trim() || undefined;
  if (telegramIntegration && chatId && leads.length > 0) {
    const notification = await prisma.notification.create({
      data: {
        tenantId,
        type: 'telegram',
        payload: {
          chatId,
          text: `AmoCRM update received: ${leads.length} lead(s), ${contacts.length} contact(s).`,
        },
        status: 'pending',
      },
    });
    await queueService.addNotificationJob(notification.id, { priority: 2 });
  }
}

async function processVoIPWebhook(event: any, tenantId: string) {
  const payload = (event.rawPayload as Record<string, unknown> | null) || {};
  const provider = String(payload.provider || payload.operator || payload.vendor || payload.source || 'utel')
    .trim()
    .toLowerCase() || 'utel';
  const callEntries = extractVoipCallEntries(payload);
  if (!callEntries.length) {
    return;
  }

  const contacts = await prisma.contact.findMany({
    where: {
      tenantId,
      phone: { not: null },
    },
    select: { id: true, phone: true },
    take: 5000,
  });

  for (let index = 0; index < callEntries.length; index += 1) {
    const entry = callEntries[index];
    if (!entry) {
      continue;
    }
    const normalizedCall = normalizeVoipCall(entry, `${provider}-${event.id}-${index}`);

    const upsertedCall = await prisma.call.upsert({
      where: {
        tenantId_provider_callIdExternal: {
          tenantId,
          provider,
          callIdExternal: normalizedCall.callIdExternal,
        },
      },
      update: {
        provider,
        from: normalizedCall.from,
        to: normalizedCall.to,
        direction: normalizedCall.direction,
        status: normalizedCall.status,
        duration: normalizedCall.duration,
        recordingUrl: normalizedCall.recordingUrl,
        recordingId: normalizedCall.recordingId,
        metadata: normalizedCall.metadata as any,
        startedAt: normalizedCall.startedAt,
        endedAt: normalizedCall.endedAt,
      },
      create: {
        tenantId,
        provider,
        callIdExternal: normalizedCall.callIdExternal,
        from: normalizedCall.from,
        to: normalizedCall.to,
        direction: normalizedCall.direction,
        status: normalizedCall.status,
        duration: normalizedCall.duration,
        recordingUrl: normalizedCall.recordingUrl,
        recordingId: normalizedCall.recordingId,
        metadata: normalizedCall.metadata as any,
        startedAt: normalizedCall.startedAt,
        endedAt: normalizedCall.endedAt,
      },
    });

    const matchedContact = contacts.find((contact) => {
      const normalized = normalizePhone(contact.phone);
      return normalized && (normalized === normalizedCall.from || normalized === normalizedCall.to);
    });

    if (!matchedContact) {
      continue;
    }

    const lead = await prisma.lead.findFirst({
      where: { tenantId, contactId: matchedContact.id },
      orderBy: { updatedAt: 'desc' },
    });

    await prisma.call.update({
      where: { id: upsertedCall.id },
      data: {
        contactId: matchedContact.id,
        leadId: lead?.id || null,
      },
    });
  }
}

async function processTelegramWebhook(event: any, tenantId: string) {
  const payload = event.rawPayload as any;
  const integration = await prisma.integration.findFirst({
    where: { tenantId, type: 'telegram' },
  });

  await prisma.integration.updateMany({
    where: { tenantId, type: 'telegram' },
    data: {
      lastSyncAt: new Date(),
      config: {
        ...((integration?.config as Record<string, unknown> | null) || {}),
        lastInboundUpdateId: payload?.update_id ? String(payload.update_id) : null,
      },
    },
  });
}

export async function processNotification(notificationId: string) {
  try {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) {
      throw new Error(`Notification ${notificationId} not found`);
    }
    if (notification.status === 'sent') {
      return;
    }

    const rateLimit = await rateLimiter.isAllowed(notification.tenantId, 'notifications:fanout', {
      maxRequests: 120,
      windowMs: 60 * 1000,
      keyPrefix: 'notifications',
    });
    if (!rateLimit.allowed) {
      throw new Error('Per-tenant notification rate limit exceeded');
    }

    if (notification.type === 'telegram') {
      const integration = await prisma.integration.findFirst({
        where: {
          tenantId: notification.tenantId,
          type: 'telegram',
          status: 'active',
        },
      });
      if (!integration?.tokensEncrypted) {
        throw new Error('No active Telegram integration found');
      }

      const tokens = decryptIntegrationTokens<{ botToken?: string }>(integration.tokensEncrypted);
      if (!tokens.botToken) {
        throw new Error('Telegram bot token is missing');
      }

      await sendTelegramNotification(notification.payload as any, tokens.botToken);
    } else if (notification.type === 'email') {
      throw new Error('Email notification not implemented');
    } else if (notification.type === 'sms') {
      throw new Error('SMS notification not implemented');
    } else {
      throw new Error(`Unsupported notification type: ${notification.type}`);
    }

    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: 'sent',
        sentAt: new Date(),
        attempts: { increment: 1 },
        errorMessage: null,
      },
    });
  } catch (error: any) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) {
      throw error;
    }

    const nextAttempts = notification.attempts + 1;
    const shouldRetry = nextAttempts < notification.maxAttempts;
    const nextRetryAt = shouldRetry
      ? new Date(Date.now() + Math.pow(2, Math.max(0, notification.attempts)) * 1000)
      : null;

    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        attempts: { increment: 1 },
        errorMessage: error.message,
        status: shouldRetry ? 'retrying' : 'failed',
        nextRetryAt,
      },
    });

    if (shouldRetry && nextRetryAt) {
      await queueService.addNotificationJob(notificationId, {
        delay: nextRetryAt.getTime() - Date.now(),
      });
    }

    throw error;
  }
}

async function sendTelegramNotification(payload: any, botToken: string) {
  if (!payload?.chatId || !payload?.text) {
    throw new Error('Telegram payload must include chatId and text');
  }

  await telegramService.sendMessage(
    botToken,
    String(payload.chatId),
    String(payload.text),
    payload.options,
  );
}

export async function processExport(exportId: string) {
  log(LogLevel.INFO, 'Processing export', { exportId });
}

export async function processIntegrationSync(integrationType: string, tenantId: string) {
  const integration = await prisma.integration.findFirst({
    where: {
      tenantId,
      type: integrationType,
      status: 'active',
    },
  });

  if (!integration) {
    throw new Error(`Active integration not found for type=${integrationType}, tenant=${tenantId}`);
  }

  await prisma.integration.update({
    where: { id: integration.id },
    data: { lastSyncAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: 'integration_sync',
      resource: 'integration',
      resourceId: integration.id,
      metadata: { type: integrationType },
    },
  });
}
