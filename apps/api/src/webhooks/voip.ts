import { systemPrisma } from '@dashboarduz/db';
import { Router, type Request, type Response } from 'express';

import { logger } from '../lib/logger';
import { isLikelyExternalPhone, normalizePhoneKeepPlus } from '../lib/phone';
import { isAllowedUtelManagerExtension, normalizeCallDirection } from '../lib/utel';
import { getDLQMetrics, getQueueMetrics, QueueName } from '../services/queue/queues';
import { EncryptionService } from '../services/security/encryption';
import { rateLimiter } from '../services/security/rate-limiter';

import { buildWebhookIdempotencyKey, enqueueWebhookJob, getRawBody, isUniqueViolation, writeWebhookRejectionAudit } from './shared';
import { firstTextValue, isLikelyInternalPhone, pickMetadataValue, prepareVoipPayload, resolveVoipProvider } from './voip-payload';

const router = Router();

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

    const integration = await systemPrisma.integration.findFirst({
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

    const idempotencyKey = buildWebhookIdempotencyKey(`voip:${provider}`, integration.tenantId, rawBody);
    const eventType = preparedPayload.eventType;

    let event;

    try {
      event = await systemPrisma.webhookEvent.create({
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
      throw error;
    }

    await enqueueWebhookJob({
      jobName: 'process-voip-webhook',
      eventId: event.id,
      tenantId: integration.tenantId,
      idempotencyKey,
    });

    await systemPrisma.auditLog.create({
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

    const integration = await systemPrisma.integration.findFirst({
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
      systemPrisma.call.count({
        where: {
          tenantId: integration.tenantId,
        },
      }),
      systemPrisma.call.findMany({
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
      systemPrisma.webhookEvent.count({
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
      const callFrom = normalizePhoneKeepPlus(call.from || '');
      const callTo = normalizePhoneKeepPlus(call.to || '');
      const fallbackExternalPhone = [callFrom, callTo].find((candidate) => isLikelyExternalPhone(candidate)) || '';
      const metadataExternalPhone = isLikelyExternalPhone(phoneFromMetadata) ? normalizePhoneKeepPlus(phoneFromMetadata) : '';
      const displayPhone = metadataExternalPhone || fallbackExternalPhone || '';
      const extensionFromMetadataNormalized = normalizePhoneKeepPlus(extensionFromMetadata || '');
      const displayExtension = (isLikelyInternalPhone(extensionFromMetadataNormalized) ? extensionFromMetadataNormalized : null)
        || (isLikelyInternalPhone(call.direction === 'outbound' ? call.from : call.to)
          ? normalizePhoneKeepPlus(call.direction === 'outbound' ? call.from : call.to)
          : null);
      const durationFromMetadataRaw = pickMetadataValue(call.metadata, ['normalized_duration', 'duration', 'billsec']);
      const durationFromMetadata = durationFromMetadataRaw && !Number.isNaN(Number(durationFromMetadataRaw))
        ? Number(durationFromMetadataRaw)
        : null;
      const directionFromMetadata = pickMetadataValue(call.metadata, ['normalized_direction', 'direction', 'call_direction', 'type']);
      const statusFromMetadata = firstTextValue([
        pickMetadataValue(call.metadata, ['status']),
        pickMetadataValue(call.metadata, ['call_status']),
        pickMetadataValue(call.metadata, ['state']),
        pickMetadataValue(call.metadata, ['result']),
      ]);
      const statusFromRow = firstTextValue([call.status]);

      return {
        id: call.id,
        provider: call.provider,
        source: 'webhook',
        status: statusFromRow && statusFromRow !== '[object Object]'
          ? statusFromRow
          : (statusFromMetadata || 'completed'),
        direction: normalizeCallDirection(directionFromMetadata || call.direction),
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
          .map((row) => normalizePhoneKeepPlus(row.extension || ''))
          .filter((value) => isAllowedUtelManagerExtension(value)),
      ),
    );

    let managerByExtension = new Map<string, string>();

    if (extensionKeys.length > 0) {
      try {
        const mappedUsers = await systemPrisma.user.findMany({
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
              normalizePhoneKeepPlus(String(user.utelManagerExternalId || '')),
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
        systemPrisma.webhookEvent.count({
          where: {
            tenantId: integration.tenantId,
            source: 'voip',
            processed: true,
          },
        }),
        systemPrisma.webhookEvent.count({
          where: {
            tenantId: integration.tenantId,
            source: 'voip',
            processed: false,
          },
        }),
        systemPrisma.webhookEvent.count({
          where: {
            tenantId: integration.tenantId,
            source: 'voip',
            errorMessage: { not: null },
          },
        }),
        systemPrisma.webhookEvent.findMany({
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
        systemPrisma.auditLog.findMany({
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
        manager: row.manager || managerByExtension.get(normalizePhoneKeepPlus(row.extension || '')) || null,
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

export { router as voipWebhookRouter };
