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

function textFromUnknown(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    const objectValue = value as Record<string, unknown>;
    const preferredKeys = ['name', 'title', 'label', 'value', 'status', 'state', 'code', 'text'];
    for (const key of preferredKeys) {
      const nested = textFromUnknown(objectValue[key]);
      if (nested) {
        return nested;
      }
    }
  }

  return '';
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
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const asNumber = Number(trimmed);
    if (!Number.isNaN(asNumber)) {
      return parseCallDate(asNumber);
    }

    // UTeL often sends local date_time without timezone in GMT+5.
    const normalized = trimmed.replace(' ', 'T');
    const localDateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
    if (localDateMatch) {
      const [, y, m, d, hh, mm, ss] = localDateMatch;
      const utcMillis = Date.UTC(
        Number(y),
        Number(m) - 1,
        Number(d),
        Number(hh) - 5,
        Number(mm),
        Number(ss),
      );
      const parsedFromLocal = new Date(utcMillis);
      return Number.isNaN(parsedFromLocal.getTime()) ? null : parsedFromLocal;
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function getObjectCandidates(entry: Record<string, unknown>): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];
  const nestedKeys = [
    'call',
    'data',
    'payload',
    'event',
    'params',
    'meta',
    'details',
    'call_data',
    'call_history',
    'cdr',
    'record',
    'event_data',
  ];
  const queue: Record<string, unknown>[] = [entry];
  const seen = new Set<Record<string, unknown>>();

  while (queue.length > 0) {
    const current = queue.shift() as Record<string, unknown>;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    candidates.push(current);

    for (const nestedKey of nestedKeys) {
      const nested = current[nestedKey];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        queue.push(nested as Record<string, unknown>);
      }
    }
  }

  return candidates;
}

function getCaseInsensitiveValue(source: Record<string, unknown>, key: string): unknown {
  if (key in source) {
    return source[key];
  }

  const normalizedKey = key.toLowerCase();
  for (const [currentKey, value] of Object.entries(source)) {
    if (currentKey.toLowerCase() === normalizedKey) {
      return value;
    }
  }

  return undefined;
}

function pickVoipValue(entry: Record<string, unknown>, keys: string[]): unknown {
  const candidates = getObjectCandidates(entry);

  for (const candidate of candidates) {
    for (const key of keys) {
      const value = getCaseInsensitiveValue(candidate, key);
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        return value;
      }
    }
  }

  return undefined;
}

function isInternalNumber(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length > 0 && digits.length <= 6;
}

function isAllowedUtelManagerExtension(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (!digits) {
    return false;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 150;
}

function isLikelyExternalPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7;
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
  directionConfidence: 'high' | 'low';
  externalPhone: string | null;
  extension: string | null;
  manager: string | null;
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

function choosePreferredNumber(existing: string | null | undefined, incoming: string | null | undefined): string {
  const existingNormalized = normalizePhone(existing || '');
  const incomingNormalized = normalizePhone(incoming || '');

  if (!existingNormalized && incomingNormalized) {
    return incomingNormalized;
  }

  if (!incomingNormalized) {
    return existingNormalized;
  }

  const existingInternal = isInternalNumber(existingNormalized);
  const incomingInternal = isInternalNumber(incomingNormalized);

  if (existingInternal && !incomingInternal) {
    return incomingNormalized;
  }

  return existingNormalized || incomingNormalized;
}

function parseDurationSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.includes(':')) {
      const parts = trimmed.split(':').map((part) => Number.parseInt(part, 10));
      if (parts.length >= 2 && parts.every((part) => Number.isFinite(part) && part >= 0)) {
        const hhOrMm = parts[0] ?? 0;
        const mmOrSs = parts[1] ?? 0;
        const maybeSs = parts[2] ?? 0;
        const seconds = parts.length === 2
          ? (hhOrMm * 60 + mmOrSs)
          : (hhOrMm * 3600 + mmOrSs * 60 + maybeSs);
        return Math.max(0, seconds);
      }
    }

    const parsed = Number.parseInt(trimmed, 10);
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
  const rawDirection = textFromUnknown(pickVoipValue(entry, [
    'direction',
    'call_direction',
    'call_type',
    'type',
    'event',
    'event_type',
  ]));

  const phone = normalizePhone(textFromUnknown(pickVoipValue(entry, [
    'phone',
    'phone_number',
    'client_phone',
    'client_number',
    'customer_phone',
    'customer_number',
    'external_phone',
    'external_number',
    'number',
    'callee_number',
    'destination_number',
    'dialed_number',
    'destination',
    'dst',
    'dst_num',
    'did',
    'cid_num',
  ])));
  const extensionRaw = normalizePhone(textFromUnknown(pickVoipValue(entry, [
    'extension',
    'extension_number',
    'ext',
    'internal',
    'line',
    'line_number',
    'agent_extension',
    'agent_ext',
    'internal_number',
    'src',
    'src_num',
    'callerid',
  ])));
  const extension = isInternalNumber(extensionRaw) ? extensionRaw : '';
  const manager = textFromUnknown(pickVoipValue(entry, [
    'manager',
    'managerName',
    'manager_name',
    'manager_full_name',
    'agent',
    'agent_name',
    'agent_full_name',
    'responsible_name',
    'operator',
    'operator_name',
    'user',
    'user_name',
    'user_display_name',
    'employee_name',
    'extension_name',
    'ext_name',
    'employee',
    'responsible',
  ])) || null;

  let from = normalizePhone(textFromUnknown(pickVoipValue(entry, [
    'from',
    'caller',
    'caller_id',
    'caller_number',
    'from_number',
    'src',
  ])));
  let to = normalizePhone(textFromUnknown(pickVoipValue(entry, [
    'to',
    'callee',
    'callee_number',
    'to_number',
    'dialed_number',
    'destination',
    'dst',
  ])));

  let direction = normalizeDirection(rawDirection);
  const hasExplicitDirection = rawDirection.length > 0;
  if (!from && !to) {
    from = direction === 'outbound' ? extension : phone;
    to = direction === 'outbound' ? phone : extension;
  }

  if (!hasExplicitDirection && from && to) {
    const fromInternal = isInternalNumber(from);
    const toInternal = isInternalNumber(to);
    if (fromInternal && !toInternal) {
      direction = 'outbound';
    } else if (!fromInternal && toInternal) {
      direction = 'inbound';
    }
  }

  if (!hasExplicitDirection && phone && extension) {
    const fromInternal = isInternalNumber(from);
    const toInternal = isInternalNumber(to);
    const fromExternal = isLikelyExternalPhone(from);
    const toExternal = isLikelyExternalPhone(to);

    if ((fromInternal && !toInternal) || (fromInternal && toExternal)) {
      direction = 'outbound';
    } else if ((toInternal && !fromInternal) || (toInternal && fromExternal)) {
      direction = 'inbound';
    } else if (!from && extension) {
      direction = 'outbound';
    }
  }
  const directionConfidence: 'high' | 'low' = hasExplicitDirection
    || (from && to && (isInternalNumber(from) !== isInternalNumber(to)))
    || Boolean(isLikelyExternalPhone(phone))
    ? 'high'
    : 'low';

  if (direction === 'outbound') {
    if (!isLikelyExternalPhone(to) && isLikelyExternalPhone(phone)) {
      to = phone;
    }
    if (!from && extension) {
      from = extension;
    }
  } else {
    if (!isLikelyExternalPhone(from) && isLikelyExternalPhone(phone)) {
      from = phone;
    }
    if (!to && extension) {
      to = extension;
    }
  }

  const pickLikelyExternal = (values: unknown[]): string | null => {
    for (const value of values) {
      const candidate = normalizePhone(textFromUnknown(value) || '');
      if (isLikelyExternalPhone(candidate)) {
        return candidate;
      }
    }
    return null;
  };

  const inboundExternalPhone = pickLikelyExternal([
    pickVoipValue(entry, ['caller', 'caller_number', 'customer_phone', 'client_phone', 'number', 'cid_num']),
    from,
    phone,
    to,
  ]);
  const outboundExternalPhone = pickLikelyExternal([
    from,
    pickVoipValue(entry, ['external_number', 'phone', 'client_phone', 'number', 'caller', 'caller_number']),
    to,
    phone,
  ]);
  const externalPhone = direction === 'inbound'
    ? (inboundExternalPhone || outboundExternalPhone)
    : (outboundExternalPhone || inboundExternalPhone);

  const startedAt = parseCallDate(pickVoipValue(entry, [
    'date_time',
    'start_time',
    'started_at',
    'startedAt',
    'date',
    'created_at',
    'timestamp',
    'time',
  ])) || new Date();
  const endedAt = parseCallDate(pickVoipValue(entry, [
    'end_time',
    'ended_at',
    'endedAt',
    'finished_at',
    'hangup_time',
  ]));
  const parsedDuration = parseDurationSeconds(pickVoipValue(entry, [
    'conversation',
    'duration',
    'call_duration',
    'total_duration',
    'billsec',
    'bill_sec',
    'talk_duration',
    'conversation_duration',
    'talk_seconds',
    'talk_time',
    'duration_sec',
  ]));
  const duration = parsedDuration ?? (endedAt
    ? Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000))
    : null);

  const callIdExternal = textFromUnknown(pickVoipValue(entry, [
    'call_id',
    'linkedid',
    'session_id',
    'uuid',
    'call_uuid',
    'uniqueid',
    'id',
    'record_id',
    'cdr_id',
  ])) || fallbackCallId;

  return {
    callIdExternal,
    from,
    to,
    direction,
    status: textFromUnknown(pickVoipValue(entry, ['status', 'call_status', 'state', 'result'])) || 'completed',
    startedAt,
    endedAt,
    duration,
    directionConfidence,
    externalPhone,
    extension: extension || (isInternalNumber(direction === 'outbound' ? from : to)
      ? (direction === 'outbound' ? from : to)
      : null),
    manager,
    recordingUrl: (() => {
      const value = pickVoipValue(entry, ['recording_url', 'record_url', 'record_url_mp3', 'recording_link']);
      return value ? String(value) : null;
    })(),
    recordingId: (() => {
      const value = pickVoipValue(entry, ['recording_id', 'record_id']);
      return value ? String(value) : null;
    })(),
    metadata: {
      ...entry,
      normalized_phone: externalPhone,
      normalized_extension: extension || (isInternalNumber(direction === 'outbound' ? from : to)
        ? (direction === 'outbound' ? from : to)
        : null),
      normalized_manager: manager,
      normalized_duration: duration,
      normalized_direction: direction,
      normalized_direction_confidence: directionConfidence,
    },
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
  let utelManagersByKey = new Map<string, string>();
  try {
    const mappedUsers = await prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        utelManagerExternalId: { not: null },
      },
      select: {
        utelManagerExternalId: true,
        name: true,
        username: true,
      },
    });
    utelManagersByKey = new Map(
      (mappedUsers as Array<{ utelManagerExternalId: string | null; name: string | null; username: string | null }>)
        .filter((user) => Boolean(user.utelManagerExternalId))
        .map((user) => ({
          ...user,
          normalizedExtension: normalizePhone(String(user.utelManagerExternalId || '')),
        }))
        .filter((user) => isAllowedUtelManagerExtension(user.normalizedExtension))
        .map((user) => [
          user.normalizedExtension.toLowerCase(),
          (user.name || user.username || String(user.utelManagerExternalId || '')).trim(),
        ]),
    );
  } catch {
    utelManagersByKey = new Map();
  }

  for (let index = 0; index < callEntries.length; index += 1) {
    const entry = callEntries[index];
    if (!entry) {
      continue;
    }
    const normalizedCall = normalizeVoipCall(entry, `${provider}-${event.id}-${index}`);
    const normalizedExtension = normalizePhone(normalizedCall.extension || '').toLowerCase();
    const managerFromMap = normalizedExtension && isAllowedUtelManagerExtension(normalizedExtension)
      ? utelManagersByKey.get(normalizedExtension)
      : null;
    const finalManager = normalizedCall.manager || managerFromMap || null;
    const finalMetadata = {
      ...(normalizedCall.metadata || {}),
      normalized_manager: finalManager,
      normalized_extension: normalizedCall.extension,
      normalized_phone: normalizedCall.externalPhone,
      normalized_duration: normalizedCall.duration,
    } as any;

    const existingCall = await prisma.call.findUnique({
      where: {
        tenantId_provider_callIdExternal: {
          tenantId,
          provider,
          callIdExternal: normalizedCall.callIdExternal,
        },
      },
      select: {
        id: true,
        from: true,
        to: true,
        direction: true,
        duration: true,
        metadata: true,
        startedAt: true,
        endedAt: true,
      },
    });

    const mergedMetadata = {
      ...((existingCall?.metadata && typeof existingCall.metadata === 'object')
        ? existingCall.metadata as Record<string, unknown>
        : {}),
      ...finalMetadata,
    } as any;

    let upsertedCall;
    if (existingCall) {
      const existingFrom = existingCall.from || '';
      const existingTo = existingCall.to || '';
      const mergedFrom = choosePreferredNumber(existingFrom, normalizedCall.from);
      const mergedTo = choosePreferredNumber(existingTo, normalizedCall.to);
      const currentDirection = existingCall.direction || 'inbound';
      const shouldUpdateDirection = normalizedCall.directionConfidence === 'high'
        || !currentDirection;
      const existingDuration = existingCall.duration;
      const nextDuration = normalizedCall.duration !== null
        ? normalizedCall.duration
        : existingDuration;

      upsertedCall = await prisma.call.update({
        where: { id: existingCall.id },
        data: {
          provider,
          from: mergedFrom,
          to: mergedTo,
          ...(normalizedCall.status ? { status: normalizedCall.status } : {}),
          ...(nextDuration !== null ? { duration: nextDuration } : {}),
          ...(normalizedCall.recordingUrl ? { recordingUrl: normalizedCall.recordingUrl } : {}),
          ...(normalizedCall.recordingId ? { recordingId: normalizedCall.recordingId } : {}),
          ...(normalizedCall.startedAt ? { startedAt: normalizedCall.startedAt } : {}),
          ...(normalizedCall.endedAt ? { endedAt: normalizedCall.endedAt } : {}),
          ...(shouldUpdateDirection ? { direction: normalizedCall.direction } : {}),
          metadata: mergedMetadata,
        },
      });
    } else {
      upsertedCall = await prisma.call.create({
        data: {
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
          metadata: finalMetadata,
          startedAt: normalizedCall.startedAt,
          endedAt: normalizedCall.endedAt,
        },
      });
    }

    const matchedContact = (contacts as Array<{ id: string; phone: string | null }>).find((contact) => {
      const normalized = normalizePhone(contact.phone);
      return normalized && (
        normalized === normalizedCall.externalPhone
        || normalized === normalizedCall.from
        || normalized === normalizedCall.to
      );
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
