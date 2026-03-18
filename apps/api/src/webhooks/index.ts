import crypto from 'crypto';
import express from 'express';
import { prisma } from '@dashboarduz/db';
import type { Request, Response } from 'express';
import { getDLQMetrics, getQueue, getQueueMetrics, QueueName } from '../services/queue/queues';
import { amocrmService } from '../services/integrations/amocrm';
import { logger } from '../lib/logger';
import { rateLimiter } from '../services/security/rate-limiter';
import { EncryptionService } from '../services/security/encryption';

const router = express.Router();

function getRawBody(req: Request): string {
  const rawBody = (req as any).rawBody;
  if (typeof rawBody === 'string') {
    return rawBody;
  }
  return JSON.stringify(req.body ?? {});
}

function buildIdempotencyKey(source: string, tenantId: string, payload: string): string {
  return crypto.createHash('sha256').update(`${source}:${tenantId}:${payload}`).digest('hex');
}

function resolveVoipProvider(req: Request): string {
  const headerProvider = req.headers['x-voip-provider'];
  const queryProvider = req.query.provider;
  const bodyProvider = req.body?.provider || req.body?.operator || req.body?.vendor;

  const provider = String(
    (Array.isArray(headerProvider) ? headerProvider[0] : headerProvider)
      || (Array.isArray(queryProvider) ? queryProvider[0] : queryProvider)
      || bodyProvider
      || 'utel',
  ).trim().toLowerCase();

  return provider || 'utel';
}

function getMetadataCandidates(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const metadata = value as Record<string, unknown>;
  const candidates: Record<string, unknown>[] = [metadata];
  const nestedKeys = ['call', 'data', 'payload', 'event', 'params', 'meta', 'details', 'call_data'];

  for (const nestedKey of nestedKeys) {
    const nested = metadata[nestedKey];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      candidates.push(nested as Record<string, unknown>);
    }
  }

  return candidates;
}

function getCaseInsensitiveMetadataValue(source: Record<string, unknown>, key: string): unknown {
  if (key in source) {
    return source[key];
  }

  const normalizedKey = key.toLowerCase();
  for (const [currentKey, currentValue] of Object.entries(source)) {
    if (currentKey.toLowerCase() === normalizedKey) {
      return currentValue;
    }
  }

  return undefined;
}

function pickMetadataValue(metadata: unknown, keys: string[]): string | null {
  const candidates = getMetadataCandidates(metadata);
  for (const candidate of candidates) {
    for (const key of keys) {
      const value = getCaseInsensitiveMetadataValue(candidate, key);
      if (value !== null && value !== undefined) {
        const normalized = String(value).trim();
        if (normalized) {
          return normalized;
        }
      }
    }
  }

  return null;
}

function normalizePhone(value: string | null): string {
  if (!value) {
    return '';
  }
  return String(value).replace(/[^\d+]/g, '');
}

function isLikelyExternalPhone(value: string | null): boolean {
  const normalized = normalizePhone(value);
  const digits = normalized.replace(/\D/g, '');
  return digits.length >= 7;
}

function isLikelyInternalPhone(value: string | null): boolean {
  const normalized = normalizePhone(value);
  const digits = normalized.replace(/\D/g, '');
  return digits.length > 0 && digits.length <= 6;
}

function normalizeDirection(value: string | null | undefined): 'inbound' | 'outbound' {
  const normalized = String(value || '').trim().toLowerCase();
  if (['out', 'outbound', 'dial_out', 'outgoing'].includes(normalized)) {
    return 'outbound';
  }
  return 'inbound';
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function textFromUnknown(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || null;
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

  return null;
}

function firstTextValue(values: unknown[]): string | null {
  for (const value of values) {
    const parsed = textFromUnknown(value);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function parseUtelDateTimeToUtcIso(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const raw = value.trim();
  if (!raw) {
    return null;
  }

  const withTimezone = /([zZ]|[+-]\d{2}:\d{2})$/.test(raw);
  if (withTimezone) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const normalized = raw.replace(' ', 'T');
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (match) {
    const [, y, m, d, hh, mm, ss] = match;
    // UTeL sends local time in GMT+5, convert to UTC for storage.
    const utcMillis = Date.UTC(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(hh) - 5,
      Number(mm),
      Number(ss),
    );
    const parsed = new Date(utcMillis);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const fallback = new Date(normalized);
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function buildCallHistoryFromFlatPayload(bodyPayload: Record<string, unknown>): Record<string, unknown> | null {
  const callHistory: Record<string, unknown> = {};
  let hasAny = false;

  for (const [key, value] of Object.entries(bodyPayload)) {
    let fieldKey: string | null = null;

    const bracketDataMatch = key.match(/^data\[call_history\]\[([^\]]+)\]$/);
    if (bracketDataMatch) {
      fieldKey = bracketDataMatch[1] || null;
    }

    const bracketDirectMatch = key.match(/^call_history\[([^\]]+)\]$/);
    if (!fieldKey && bracketDirectMatch) {
      fieldKey = bracketDirectMatch[1] || null;
    }

    const dottedDataMatch = key.match(/^data\.call_history\.([^.]+)$/);
    if (!fieldKey && dottedDataMatch) {
      fieldKey = dottedDataMatch[1] || null;
    }

    const dottedDirectMatch = key.match(/^call_history\.([^.]+)$/);
    if (!fieldKey && dottedDirectMatch) {
      fieldKey = dottedDirectMatch[1] || null;
    }

    if (fieldKey) {
      callHistory[fieldKey] = value;
      hasAny = true;
    }
  }

  return hasAny ? callHistory : null;
}

function resolveFlatEventName(bodyPayload: Record<string, unknown>): string {
  const direct = String(
    bodyPayload.event
    || bodyPayload.name
    || bodyPayload.event_type
    || '',
  ).trim().toLowerCase();
  if (direct) {
    return direct;
  }

  const fromFlatData = String(bodyPayload['data[name]'] || bodyPayload['data.name'] || '').trim().toLowerCase();
  return fromFlatData;
}

function inferUtelDirection(src: string, dst: string, rawDirection: unknown): 'inbound' | 'outbound' {
  const explicitRaw = textFromUnknown(rawDirection);
  const explicit = normalizeDirection(explicitRaw || undefined);
  if (explicitRaw) {
    return explicit;
  }

  const srcInternal = isLikelyInternalPhone(src);
  const dstInternal = isLikelyInternalPhone(dst);
  const srcExternal = isLikelyExternalPhone(src);
  const dstExternal = isLikelyExternalPhone(dst);

  if (srcInternal && dstExternal) {
    return 'outbound';
  }
  if (srcExternal && dstInternal) {
    return 'inbound';
  }
  return 'inbound';
}

function prepareVoipPayload(provider: string, bodyPayload: Record<string, unknown>): {
  ignored: boolean;
  reason?: string;
  payload: Record<string, unknown>;
  eventType: string;
} {
  if (provider !== 'utel') {
    return {
      ignored: false,
      payload: { ...bodyPayload, provider },
      eventType: typeof bodyPayload.event_type === 'string' && bodyPayload.event_type.trim()
        ? bodyPayload.event_type
        : 'call_event',
    };
  }

  const dataObj = asObject(bodyPayload.data);
  const eventName = String(
    (dataObj?.name as string | undefined)
    || (bodyPayload.event as string | undefined)
    || (bodyPayload.name as string | undefined)
    || (bodyPayload.event_type as string | undefined)
    || resolveFlatEventName(bodyPayload)
    || '',
  ).trim().toLowerCase();
  const callHistory = asObject((dataObj?.call_history as unknown)
    || bodyPayload.call_history
    || bodyPayload.callHistory)
    || buildCallHistoryFromFlatPayload(bodyPayload);

  if (callHistory) {
    const src = normalizePhone(String(callHistory.src || callHistory.from || callHistory.source || ''));
    const dst = normalizePhone(String(callHistory.dst || callHistory.to || callHistory.destination || ''));
    const direction = inferUtelDirection(
      src,
      dst,
      callHistory.direction
      || callHistory.call_direction
      || dataObj?.direction
      || bodyPayload.direction
      || bodyPayload.call_direction,
    );
    const externalPhone = normalizePhone(String(
      callHistory.external_number
      || callHistory.phone
      || callHistory.client_phone
      || (direction === 'outbound' ? dst : src)
      || '',
    ));
    const extension = normalizePhone(String(
      callHistory.extension
      || callHistory.ext
      || (direction === 'outbound' ? src : dst)
      || '',
    ));
    const manager = firstTextValue([
      callHistory.manager,
      callHistory.manager_name,
      callHistory.user_name,
      callHistory.agent_name,
      callHistory.operator_name,
      callHistory.employee_name,
    ]);
    const duration = toInt(callHistory.conversation ?? callHistory.duration ?? callHistory.billsec);
    const startedAtIso = parseUtelDateTimeToUtcIso(
      callHistory.date_time
      || callHistory.start_time
      || callHistory.started_at,
    );

    const normalizedCall = {
      call_id: String(
        callHistory.call_id
        || callHistory.linkedid
        || callHistory.uniqueid
        || callHistory.uuid
        || callHistory.id
        || '',
      ).trim() || undefined,
      direction,
      from: src,
      to: externalPhone || dst,
      src,
      dst,
      extension,
      phone: externalPhone,
      external_number: externalPhone || undefined,
      manager_name: manager || undefined,
      duration: duration ?? undefined,
      conversation: duration ?? undefined,
      start_time: startedAtIso || undefined,
      date_time: callHistory.date_time || undefined,
      status: firstTextValue([callHistory.status, callHistory.state, bodyPayload.status, bodyPayload.state]) || 'completed',
      raw_call_history: callHistory,
    };

    return {
      ignored: false,
      eventType: 'call_saved',
      payload: {
        ...bodyPayload,
        provider,
        event_type: 'call_saved',
        call: normalizedCall,
        call_history: callHistory,
      },
    };
  }

  if (eventName && eventName !== 'call_saved') {
    return {
      ignored: true,
      reason: `ignored_utel_event_${eventName}`,
      payload: { ...bodyPayload, provider },
      eventType: eventName,
    };
  }

  return {
    ignored: true,
    reason: 'ignored_utel_event_missing_call_history',
    payload: { ...bodyPayload, provider },
    eventType: eventName || 'call_event',
  };
}

function isUniqueViolation(error: any): boolean {
  return error?.code === 'P2002';
}

function isMissingWebhookIdempotencyColumnError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('idempotencykey') && message.includes('does not exist');
}

async function enqueueWebhookJob(params: {
  jobName: string;
  eventId: string;
  tenantId: string;
  idempotencyKey: string;
}) {
  const webhookQueue = getQueue(QueueName.WEBHOOK_PROCESSING);
  await webhookQueue.add(
    params.jobName,
    {
      eventId: params.eventId,
      tenantId: params.tenantId,
      idempotencyKey: params.idempotencyKey,
    },
    {
      jobId: `${params.jobName}:${params.tenantId}:${params.idempotencyKey}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: true,
    },
  );
}

async function writeWebhookRejectionAudit(params: {
  tenantId: string;
  reason: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: params.tenantId,
        action: 'webhook_rejected',
        resource: 'webhook',
        metadata: {
          reason: params.reason,
          ...(params.metadata || {}),
        },
      },
    });
  } catch (auditError: any) {
    logger.warn({ err: auditError, msg: 'Failed to write webhook rejection audit log' });
  }
}

router.post('/amocrm', async (req: Request, res: Response) => {
  try {
    const signature = (req.headers['x-signature'] || req.headers['x-amocrm-signature']) as string | undefined;
    const rawBody = getRawBody(req);

    const isValid = amocrmService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      logger.warn({ msg: 'Invalid AmoCRM webhook signature' });
      return res.status(403).json({ error: 'Invalid signature' });
    }

    const accountIdRaw = req.body?.account?.id ?? req.body?.account_id;
    if (!accountIdRaw) {
      return res.status(400).json({ error: 'Missing AmoCRM account id' });
    }

    const accountId = String(accountIdRaw);
    const integration = await prisma.integration.findFirst({
      where: {
        type: 'amocrm',
        status: 'active',
        config: {
          path: ['account_id'],
          equals: accountId,
        },
      },
    });

    if (!integration) {
      logger.warn({ msg: 'AmoCRM integration not found', accountId });
      return res.status(404).json({ error: 'Integration not found' });
    }

    const webhookLimit = await rateLimiter.isAllowed(integration.tenantId, 'webhook:amocrm', {
      maxRequests: 600,
      windowMs: 60 * 1000,
      keyPrefix: 'webhook',
    });
    if (!webhookLimit.allowed) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    const idempotencyKey = buildIdempotencyKey('amocrm', integration.tenantId, rawBody);
    const eventType = req.body?.event_type
      || (req.body?.leads ? 'leads' : req.body?.contacts ? 'contacts' : 'unknown');

    let event;
    try {
      event = await prisma.webhookEvent.create({
        data: {
          tenantId: integration.tenantId,
          source: 'amocrm',
          eventType,
          idempotencyKey,
          rawPayload: req.body,
          signature: signature || null,
          processed: false,
        },
      });
    } catch (error: any) {
      if (isUniqueViolation(error)) {
        logger.info({ msg: 'Duplicate AmoCRM webhook ignored', idempotencyKey });
        return res.status(200).json({ received: true, duplicate: true });
      }
      if (isMissingWebhookIdempotencyColumnError(error)) {
        logger.warn({ msg: 'WebhookEvent.idempotencyKey column missing, creating event without idempotency key' });
        event = await prisma.webhookEvent.create({
          data: {
            tenantId: integration.tenantId,
            source: 'amocrm',
            eventType,
            rawPayload: req.body,
            signature: signature || null,
            processed: false,
          },
        });
      } else {
        throw error;
      }
    }

    await enqueueWebhookJob({
      jobName: 'process-amocrm-webhook',
      eventId: event.id,
      tenantId: integration.tenantId,
      idempotencyKey,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: integration.tenantId,
        action: 'webhook_received',
        resource: 'webhook',
        resourceId: event.id,
        metadata: { source: 'amocrm', eventType },
      },
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, 'AmoCRM webhook handler failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

async function handleVoipWebhook(req: Request, res: Response) {
  let tenantIdForAudit: string | null = null;
  let providerForAudit = 'utel';

  try {
    const rawBody = getRawBody(req);
    const signature = req.headers['x-signature'] as string | undefined;
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : {};
    const authHeader = req.headers.authorization;
    const bearerToken = typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : undefined;
    const integrationKey = String(
      (req.query.integration_key as string | undefined)
      || (req.query.integrationKey as string | undefined)
      || (req.headers['x-integration-key'] as string | undefined)
      || (req.headers['x-webhook-key'] as string | undefined)
      || (typeof body.integration_key === 'string' ? body.integration_key : undefined)
      || (typeof body.integrationKey === 'string' ? body.integrationKey : undefined)
      || (typeof body.webhook_key === 'string' ? body.webhook_key : undefined)
      || (typeof body.key === 'string' ? body.key : undefined)
      || bearerToken
      || '',
    ).trim();

    if (!integrationKey) {
      return res.status(400).json({ error: 'Missing integration key' });
    }

    const integration = await prisma.integration.findFirst({
      where: {
        type: 'voip_utel',
        status: 'active',
        config: {
          path: ['webhookKey'],
          equals: integrationKey,
        },
      },
    });

    if (!integration) {
      logger.warn({ msg: 'UTeL integration not found for key' });
      return res.status(404).json({ error: 'Integration not found' });
    }
    tenantIdForAudit = integration.tenantId;

    const webhookSecret = process.env.UTEL_WEBHOOK_SECRET;
    if (webhookSecret && signature) {
      const isValidSignature = EncryptionService.verifyHMAC(rawBody, signature, webhookSecret);
      if (!isValidSignature) {
        await writeWebhookRejectionAudit({
          tenantId: integration.tenantId,
          reason: 'invalid_signature',
          metadata: {
            source: 'voip',
            hasSignature: true,
          },
        });
        return res.status(403).json({ error: 'Invalid signature' });
      }
    } else if (webhookSecret && !signature) {
      logger.warn({ msg: 'VoIP webhook received without signature; accepted via integration key auth only' });
    } else if (process.env.NODE_ENV === 'production') {
      logger.warn({ msg: 'UTEL_WEBHOOK_SECRET is not configured in production' });
    }

    const webhookLimit = await rateLimiter.isAllowed(integration.tenantId, 'webhook:voip', {
      maxRequests: 300,
      windowMs: 60 * 1000,
      keyPrefix: 'webhook',
    });
    if (!webhookLimit.allowed) {
      await writeWebhookRejectionAudit({
        tenantId: integration.tenantId,
        reason: 'rate_limit_exceeded',
        metadata: {
          source: 'voip',
        },
      });
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    const bodyPayload: Record<string, unknown> = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : { raw: req.body as unknown };
    const provider = resolveVoipProvider(req);
    providerForAudit = provider;
    const preparedPayload = prepareVoipPayload(provider, bodyPayload);
    if (preparedPayload.ignored) {
      await writeWebhookRejectionAudit({
        tenantId: integration.tenantId,
        reason: preparedPayload.reason || 'ignored_event',
        metadata: {
          source: 'voip',
          provider,
          eventType: preparedPayload.eventType,
        },
      });
      return res.status(200).json({ received: true, ignored: true, reason: preparedPayload.reason || 'ignored_event' });
    }

    const idempotencyKey = buildIdempotencyKey(`voip:${provider}`, integration.tenantId, rawBody);
    const eventType = preparedPayload.eventType;

    let event;
    try {
      event = await prisma.webhookEvent.create({
        data: {
          tenantId: integration.tenantId,
          source: 'voip',
          eventType,
          idempotencyKey: `${provider}:${idempotencyKey}`,
          rawPayload: preparedPayload.payload as any,
          signature: signature || null,
          processed: false,
        },
      });
    } catch (error: any) {
      if (isUniqueViolation(error)) {
        logger.info({ msg: 'Duplicate VoIP webhook ignored', idempotencyKey, provider });
        return res.status(200).json({ received: true, duplicate: true });
      }
      if (isMissingWebhookIdempotencyColumnError(error)) {
        logger.warn({ msg: 'WebhookEvent.idempotencyKey column missing, creating VoIP event without idempotency key' });
        event = await prisma.webhookEvent.create({
          data: {
            tenantId: integration.tenantId,
            source: 'voip',
            eventType,
            rawPayload: preparedPayload.payload as any,
            signature: signature || null,
            processed: false,
          },
        });
      } else {
        throw error;
      }
    }

    await enqueueWebhookJob({
      jobName: 'process-voip-webhook',
      eventId: event.id,
      tenantId: integration.tenantId,
      idempotencyKey,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: integration.tenantId,
        action: 'webhook_received',
        resource: 'webhook',
        resourceId: event.id,
        metadata: { source: 'voip', provider, eventType },
      },
    });

    return res.status(200).json({ received: true });
  } catch (err: any) {
    if (tenantIdForAudit) {
      await writeWebhookRejectionAudit({
        tenantId: tenantIdForAudit,
        reason: 'handler_exception',
        metadata: {
          source: 'voip',
          provider: providerForAudit,
          error: err?.message || 'Unknown error',
        },
      });
    }
    logger.error({ err }, 'VoIP webhook handler failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleVoipWebhookStatus(req: Request, res: Response) {
  try {
    const integrationKey = (req.query.integration_key as string | undefined)
      || (req.headers['x-integration-key'] as string | undefined);
    const debugEnabled = String(req.query.debug || '').toLowerCase() === '1'
      || String(req.query.debug || '').toLowerCase() === 'true';

    if (!integrationKey) {
      return res.status(200).json({
        ok: true,
        endpoint: '/webhooks/utel',
        method: 'POST',
        message: 'Webhook endpoint is alive. Send POST with integration_key query param.',
      });
    }

    const integration = await prisma.integration.findFirst({
      where: {
        type: 'voip_utel',
        status: 'active',
        config: {
          path: ['webhookKey'],
          equals: integrationKey,
        },
      },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (!integration) {
      return res.status(404).json({ ok: false, error: 'Integration not found' });
    }

    const [totalCalls, recentCalls, receivedEvents] = await Promise.all([
      prisma.call.count({
        where: {
          tenantId: integration.tenantId,
        },
      }),
      prisma.call.findMany({
        where: {
          tenantId: integration.tenantId,
        },
        orderBy: { startedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          direction: true,
          startedAt: true,
          duration: true,
          from: true,
          to: true,
          provider: true,
          status: true,
          metadata: true,
        },
      }),
      prisma.webhookEvent.count({
        where: {
          tenantId: integration.tenantId,
          source: 'voip',
        },
      }),
    ]);

    const mappedRows = recentCalls.map((call) => {
      const manager = pickMetadataValue(call.metadata, [
        'normalized_manager',
        'manager',
        'manager_name',
        'agent',
        'agent_name',
        'operator',
        'user',
        'employee',
        'responsible',
      ]);
      const extensionFromMetadata = pickMetadataValue(call.metadata, [
        'normalized_extension',
        'extension',
        'ext',
        'internal',
        'line',
        'internal_number',
        'agent_extension',
        'src',
      ]);
      const phoneFromMetadata = pickMetadataValue(call.metadata, [
        'normalized_phone',
        'phone',
        'phone_number',
        'client_phone',
        'customer_phone',
        'external_phone',
        'number',
        'dst',
        'to',
        'callee',
      ]);
      const callFrom = normalizePhone(call.from || '');
      const callTo = normalizePhone(call.to || '');
      const fallbackExternalPhone = [callFrom, callTo].find((candidate) => isLikelyExternalPhone(candidate)) || '';
      const metadataExternalPhone = isLikelyExternalPhone(phoneFromMetadata) ? normalizePhone(phoneFromMetadata) : '';
      const displayPhone = metadataExternalPhone || fallbackExternalPhone || '';
      const displayExtension = extensionFromMetadata
        || (isLikelyInternalPhone(call.direction === 'outbound' ? call.from : call.to)
          ? normalizePhone(call.direction === 'outbound' ? call.from : call.to)
          : null);
      const durationFromMetadataRaw = pickMetadataValue(call.metadata, ['normalized_duration', 'duration', 'billsec']);
      const durationFromMetadata = durationFromMetadataRaw && !Number.isNaN(Number(durationFromMetadataRaw))
        ? Number(durationFromMetadataRaw)
        : null;
      const directionFromMetadata = pickMetadataValue(call.metadata, ['normalized_direction', 'direction', 'call_direction', 'type']);

      return {
        id: call.id,
        provider: call.provider,
        source: 'webhook',
        status: call.status,
        direction: normalizeDirection(directionFromMetadata || call.direction),
        date: call.startedAt,
        duration: call.duration ?? durationFromMetadata,
        phone: displayPhone,
        extension: displayExtension || null,
        manager: manager || null,
      };
    });

    const extensionKeys = Array.from(
      new Set(
        mappedRows
          .map((row) => normalizePhone(row.extension || ''))
          .filter((value) => Boolean(value)),
      ),
    );

    let managerByExtension = new Map<string, string>();
    if (extensionKeys.length > 0) {
      try {
        const mappedUsers = await prisma.user.findMany({
          where: {
            tenantId: integration.tenantId,
            isActive: true,
            utelManagerExternalId: {
              in: extensionKeys,
            },
          },
          select: {
            utelManagerExternalId: true,
            name: true,
            username: true,
          },
        });
        managerByExtension = new Map(
          mappedUsers
            .filter((user) => Boolean(user.utelManagerExternalId))
            .map((user) => [
              normalizePhone(String(user.utelManagerExternalId || '')),
              String(user.name || user.username || user.utelManagerExternalId || '').trim(),
            ]),
        );
      } catch {
        managerByExtension = new Map();
      }
    }

    let diagnostics: Record<string, unknown> | null = null;
    if (debugEnabled) {
      const [
        processedWebhookEvents,
        pendingWebhookEvents,
        failedWebhookEvents,
        recentWebhookEvents,
        recentWebhookRejections,
      ] = await Promise.all([
        prisma.webhookEvent.count({
          where: {
            tenantId: integration.tenantId,
            source: 'voip',
            processed: true,
          },
        }),
        prisma.webhookEvent.count({
          where: {
            tenantId: integration.tenantId,
            source: 'voip',
            processed: false,
          },
        }),
        prisma.webhookEvent.count({
          where: {
            tenantId: integration.tenantId,
            source: 'voip',
            errorMessage: { not: null },
          },
        }),
        prisma.webhookEvent.findMany({
          where: {
            tenantId: integration.tenantId,
            source: 'voip',
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            eventType: true,
            processed: true,
            processedAt: true,
            retryCount: true,
            errorMessage: true,
            createdAt: true,
            rawPayload: true,
          },
        }),
        prisma.auditLog.findMany({
          where: {
            tenantId: integration.tenantId,
            action: 'webhook_rejected',
            resource: 'webhook',
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            createdAt: true,
            metadata: true,
          },
        }),
      ]);

      let queueMetrics: Record<string, unknown>;
      try {
        const [webhookQueue, webhookDLQ] = await Promise.all([
          getQueueMetrics(QueueName.WEBHOOK_PROCESSING),
          getDLQMetrics(QueueName.WEBHOOK_PROCESSING),
        ]);
        queueMetrics = {
          webhookQueue,
          webhookDLQ,
        };
      } catch (queueError: any) {
        queueMetrics = {
          error: queueError?.message || 'Failed to read queue metrics',
        };
      }

      diagnostics = {
        processedWebhookEvents,
        pendingWebhookEvents,
        failedWebhookEvents,
        queueMetrics,
        recentWebhookRejections,
        recentWebhookEvents: recentWebhookEvents.map((event) => {
          const payload = event.rawPayload && typeof event.rawPayload === 'object'
            ? event.rawPayload as Record<string, unknown>
            : {};
          const provider = typeof payload.provider === 'string' ? payload.provider : null;
          return {
            id: event.id,
            eventType: event.eventType,
            provider,
            processed: event.processed,
            retryCount: event.retryCount,
            errorMessage: event.errorMessage,
            createdAt: event.createdAt,
            processedAt: event.processedAt,
          };
        }),
      };
    }

    return res.status(200).json({
      ok: true,
      endpoint: '/webhooks/utel',
      method: 'POST',
      integration: 'active',
      tenantId: integration.tenantId,
      totalCalls,
      totalWebhookEvents: receivedEvents,
      ...(diagnostics ? { diagnostics } : {}),
      recentCalls: mappedRows.map((row) => ({
        ...row,
        manager: row.manager || managerByExtension.get(normalizePhone(row.extension || '')) || null,
      })),
    });
  } catch (err) {
    logger.error({ err }, 'VoIP webhook status handler failed');
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
}

router.get('/utel', handleVoipWebhookStatus);
router.get('/voip', handleVoipWebhookStatus);
router.post('/utel', handleVoipWebhook);
router.post('/voip', handleVoipWebhook);

router.post('/telegram', async (req: Request, res: Response) => {
  try {
    const rawBody = getRawBody(req);
    const secretToken = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;
    if (!secretToken) {
      return res.status(403).json({ error: 'Missing Telegram secret token' });
    }

    const integration = await prisma.integration.findFirst({
      where: {
        type: 'telegram',
        status: 'active',
        config: {
          path: ['webhookSecret'],
          equals: secretToken,
        },
      },
    });

    if (!integration) {
      return res.status(404).json({ error: 'Integration not found' });
    }

    const webhookLimit = await rateLimiter.isAllowed(integration.tenantId, 'webhook:telegram', {
      maxRequests: 300,
      windowMs: 60 * 1000,
      keyPrefix: 'webhook',
    });
    if (!webhookLimit.allowed) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    const idempotencyKey = buildIdempotencyKey('telegram', integration.tenantId, rawBody);
    const eventType = req.body?.message ? 'message' : req.body?.callback_query ? 'callback_query' : 'update';

    let event;
    try {
      event = await prisma.webhookEvent.create({
        data: {
          tenantId: integration.tenantId,
          source: 'telegram',
          eventType,
          idempotencyKey,
          rawPayload: req.body,
          processed: false,
        },
      });
    } catch (error: any) {
      if (isUniqueViolation(error)) {
        logger.info({ msg: 'Duplicate Telegram webhook ignored', idempotencyKey });
        return res.status(200).json({ received: true, duplicate: true });
      }
      if (isMissingWebhookIdempotencyColumnError(error)) {
        logger.warn({ msg: 'WebhookEvent.idempotencyKey column missing, creating Telegram event without idempotency key' });
        event = await prisma.webhookEvent.create({
          data: {
            tenantId: integration.tenantId,
            source: 'telegram',
            eventType,
            rawPayload: req.body,
            processed: false,
          },
        });
      } else {
        throw error;
      }
    }

    await enqueueWebhookJob({
      jobName: 'process-telegram-webhook',
      eventId: event.id,
      tenantId: integration.tenantId,
      idempotencyKey,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: integration.tenantId,
        action: 'webhook_received',
        resource: 'webhook',
        resourceId: event.id,
        metadata: { source: 'telegram', eventType },
      },
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, 'Telegram webhook handler failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
