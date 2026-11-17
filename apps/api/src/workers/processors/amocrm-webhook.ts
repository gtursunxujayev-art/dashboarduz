import { type Prisma, systemPrisma } from '@dashboarduz/db';

import { parseAmoTimestamp } from '../../lib/amocrm';
import { isUniqueViolation } from '../../lib/prisma-errors';
import { getSelectedPipelineIds } from '../../services/integrations/amocrm-live';
import { queueService } from '../../services/queue';

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

export async function processAmoCRMWebhook(event: any, tenantId: string) {
  const payload = event.rawPayload as any;
  const leads = extractAmoEntities(payload, 'leads');
  const contacts = extractAmoEntities(payload, 'contacts');
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

    await systemPrisma.lead.upsert({
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
        // The stored payload comes from the lead snapshot (API format). A webhook payload has a
        // different shape, so a webhook only updates the columns above.
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
    const amocrmId = String(contactData.id ?? '').trim();

    if (!amocrmId) continue;
    await upsertAmoContact({ tenantId, amocrmId, name, phone, email, payload: contactData });
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
  const chatId = String(((tenant?.settings as any)?.notificationChatId || '')).trim() || undefined;

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
