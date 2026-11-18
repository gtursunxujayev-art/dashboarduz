import { type Prisma, systemPrisma } from '@dashboarduz/db';
import type { WebhookEvent } from '@prisma/client';

import { parseAmoTimestamp } from '../../lib/amocrm';
import { asObject } from '../../lib/object';
import { isUniqueViolation } from '../../lib/prisma-errors';
import { writeLeadsByAmoId } from '../../services/integrations/amocrm-lead-store';
import { getSelectedPipelineIds } from '../../services/integrations/amocrm-live';
import { queueService } from '../../services/queue';
import {
  amoWebhookContactField,
  amoWebhookContactListValue,
  amoWebhookEntities,
  amoWebhookLeadFields,
  webhookField,
  webhookPayloadJson,
  webhookTextOrNull,
} from '../../webhooks/payloads';

type AmoContactInput = {
  tenantId: string;
  amocrmId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  payload: Prisma.InputJsonValue;
};

function contactExternalIds(existing: unknown, amocrmId: string): Prisma.InputJsonValue {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing as Record<string, unknown> : {};

  return { ...base, amocrm_id: amocrmId } as Prisma.InputJsonValue;
}

/**
 * Stores an amoCRM contact, keyed by (tenantId, amocrmId) which is unique. A contact created before the key
 * existed may only match by phone or email; it is adopted (given the amoCRM id) once. Creation is an upsert, so
 * two deliveries of the same contact at once cannot create two rows.
 */
async function upsertAmoContact(input: AmoContactInput): Promise<void> {
  const { tenantId, amocrmId, name, phone, email, payload } = input;
  const existing = await systemPrisma.contact.findUnique({ where: { tenantId_amocrmId: { tenantId, amocrmId } } });
  const legacy = existing || (!phone && !email)
    ? null
    : await systemPrisma.contact.findFirst({
      where: { tenantId, amocrmId: null, OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])] },
      orderBy: { updatedAt: 'desc' },
    });

  if (legacy) {
    try {
      await systemPrisma.contact.update({
        where: { id: legacy.id },
        data: {
          amocrmId,
          name: name || legacy.name,
          phone: phone || legacy.phone,
          email: email || legacy.email,
          externalIds: contactExternalIds(legacy.externalIds, amocrmId),
          metadata: payload,
        },
      });

      return;
    } catch (error: unknown) {
      // A concurrent delivery already stored this amoCRM id: fall through and update that row instead.
      if (!isUniqueViolation(error)) throw error;
    }
  }

  await systemPrisma.contact.upsert({
    where: { tenantId_amocrmId: { tenantId, amocrmId } },
    create: {
      tenantId,
      amocrmId,
      name,
      phone,
      email,
      externalIds: { amocrm_id: amocrmId },
      metadata: payload,
    },
    update: {
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      ...(existing ? { externalIds: contactExternalIds(existing.externalIds, amocrmId) } : {}),
      metadata: payload,
    },
  });
}

export async function processAmoCRMWebhook(event: Pick<WebhookEvent, 'rawPayload'>, tenantId: string) {
  const payload = event.rawPayload;
  const leads = amoWebhookEntities(payload, 'leads');
  const contacts = amoWebhookEntities(payload, 'contacts');
  const integration = await systemPrisma.integration.findUnique({
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

  for (const leadItem of leads) {
    const leadData = amoWebhookLeadFields(leadItem);
    const leadId = leadData.id ? String(leadData.id) : null;

    if (!leadId) {
      continue;
    }

    const pipelineId = leadData.pipeline_id ? String(leadData.pipeline_id) : null;

    if (selectedPipelineIds && (!pipelineId || !selectedPipelineIds.includes(pipelineId))) {
      continue;
    }

    const externalCreatedAt = parseAmoTimestamp(leadData.created_at);
    const externalUpdatedAt = parseAmoTimestamp(leadData.updated_at);

    const columns = {
      title: webhookTextOrNull(leadData.name, 'lead name') || 'Untitled Lead',
      status: leadData.status_id ? String(leadData.status_id) : null,
      pipelineId,
      responsibleUserId: leadData.responsible_user_id ? String(leadData.responsible_user_id) : null,
      source: 'amocrm',
      externalCreatedAt,
      externalUpdatedAt,
    };

    // Looks the lead up first instead of upsert: production has no (tenantId, amocrmId) unique index.
    await writeLeadsByAmoId(tenantId, [{
      amocrmId: leadId,
      // The stored payload comes from the lead snapshot (API format). A webhook payload has a
      // different shape, so a webhook only updates the columns above.
      update: { ...columns, updatedAt: new Date() },
      create: { ...columns, metadata: webhookPayloadJson(leadItem) },
    }], systemPrisma);
  }

  for (const contactData of contacts) {
    const phone = amoWebhookContactField(contactData, 'PHONE')
      || webhookTextOrNull(amoWebhookContactListValue(contactData, 'phone'), 'contact phone');
    const email = amoWebhookContactField(contactData, 'EMAIL')
      || webhookTextOrNull(amoWebhookContactListValue(contactData, 'email'), 'contact email');
    const name = webhookTextOrNull(webhookField(contactData, 'name'), 'contact name');
    const amocrmId = String(webhookField(contactData, 'id') ?? '').trim();

    if (!amocrmId) continue;
    await upsertAmoContact({ tenantId, amocrmId, name, phone, email, payload: webhookPayloadJson(contactData) });
  }

  const [telegramIntegration, tenant] = await Promise.all([
    systemPrisma.integration.findFirst({
      where: { tenantId, type: 'telegram', status: 'active' },
    }),
    systemPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    }),
  ]);
  const chatId = String(asObject(tenant?.settings)?.notificationChatId || '').trim() || undefined;

  if (telegramIntegration && chatId && leads.length > 0) {
    const notification = await systemPrisma.notification.create({
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
