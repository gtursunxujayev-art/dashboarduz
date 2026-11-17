import { systemPrisma } from '@dashboarduz/db';

import { parseAmoTimestamp } from '../../lib/amocrm';
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

    const existingContact = await systemPrisma.contact.findFirst({
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

      await systemPrisma.contact.update({
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
      await systemPrisma.contact.create({
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
