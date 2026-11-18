import { systemPrisma } from '@dashboarduz/db';

import { writeLeadsByAmoId } from '../../../services/integrations/amocrm-lead-store';
import { queueService } from '../../../services/queue';
import { processAmoCRMWebhook } from '../amocrm-webhook';

jest.mock('../../../services/integrations/amocrm-lead-store', () => ({ writeLeadsByAmoId: jest.fn() }));

const writeLeads = jest.mocked(writeLeadsByAmoId);

let findIntegrationUnique: jest.SpyInstance;
let findTelegramIntegration: jest.SpyInstance;
let findTenant: jest.SpyInstance;
let findContact: jest.SpyInstance;
let findLegacyContact: jest.SpyInstance;
let updateContact: jest.SpyInstance;
let upsertContact: jest.SpyInstance;
let createNotification: jest.SpyInstance;
let addNotificationJob: jest.SpyInstance;

beforeEach(() => {
  writeLeads.mockResolvedValue({ created: 1, updated: 0 });
  findIntegrationUnique = jest.spyOn(systemPrisma.integration, 'findUnique').mockResolvedValue({ config: {} } as never);
  findTelegramIntegration = jest.spyOn(systemPrisma.integration, 'findFirst').mockResolvedValue(null);
  findTenant = jest.spyOn(systemPrisma.tenant, 'findUnique').mockResolvedValue({ settings: {} } as never);
  findContact = jest.spyOn(systemPrisma.contact, 'findUnique').mockResolvedValue(null);
  findLegacyContact = jest.spyOn(systemPrisma.contact, 'findFirst').mockResolvedValue(null);
  updateContact = jest.spyOn(systemPrisma.contact, 'update').mockResolvedValue({} as never);
  upsertContact = jest.spyOn(systemPrisma.contact, 'upsert').mockResolvedValue({} as never);
  createNotification = jest.spyOn(systemPrisma.notification, 'create').mockResolvedValue({ id: 'n-1' } as never);
  addNotificationJob = jest.spyOn(queueService, 'addNotificationJob').mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

const formLead = {
  id: '101',
  name: 'New deal',
  status_id: '142',
  pipeline_id: '7',
  responsible_user_id: '9',
  created_at: '1700000000',
  updated_at: '1700000600',
};

describe('processAmoCRMWebhook leads', () => {
  it('writes the lead columns from a form-encoded add list', async () => {
    await processAmoCRMWebhook({ rawPayload: { leads: { add: [formLead] } } }, 'tenant-1');

    expect(findIntegrationUnique).toHaveBeenCalledWith({
      where: { tenantId_type: { tenantId: 'tenant-1', type: 'amocrm' } },
      select: { config: true },
    });
    const columns = {
      title: 'New deal',
      status: '142',
      pipelineId: '7',
      responsibleUserId: '9',
      source: 'amocrm',
      externalCreatedAt: new Date(1700000000 * 1000),
      externalUpdatedAt: new Date(1700000600 * 1000),
    };

    expect(writeLeads).toHaveBeenCalledWith('tenant-1', [{
      amocrmId: '101',
      update: { ...columns, updatedAt: expect.any(Date) },
      create: { ...columns, metadata: formLead },
    }], systemPrisma);
  });

  it('defaults the title and leaves absent ids null', async () => {
    await processAmoCRMWebhook({ rawPayload: { leads: [{ id: 5 }] } }, 'tenant-1');

    expect(writeLeads).toHaveBeenCalledWith('tenant-1', [expect.objectContaining({
      amocrmId: '5',
      create: {
        title: 'Untitled Lead',
        status: null,
        pipelineId: null,
        responsibleUserId: null,
        source: 'amocrm',
        externalCreatedAt: null,
        externalUpdatedAt: null,
        metadata: { id: 5 },
      },
    })], systemPrisma);
  });

  it('skips leads without an id and leads outside the selected pipelines', async () => {
    findIntegrationUnique.mockResolvedValue({ config: { selectedPipelineIds: ['7'] } });

    await processAmoCRMWebhook({
      rawPayload: { leads: [{ name: 'no id' }, { ...formLead, id: '1', pipeline_id: '8' }, { ...formLead, id: '2', pipeline_id: undefined }, formLead] },
    }, 'tenant-1');

    expect(writeLeads).toHaveBeenCalledTimes(1);
    expect(writeLeads.mock.calls[0]?.[1][0]?.amocrmId).toBe('101');
  });

  it('fails the job for a lead name that is not text (as the database write did)', async () => {
    await expect(processAmoCRMWebhook({ rawPayload: { leads: [{ id: '1', name: 12 }] } }, 'tenant-1'))
      .rejects.toThrow('Webhook field lead name must be text');
    expect(writeLeads).not.toHaveBeenCalled();
  });
});

describe('processAmoCRMWebhook contacts', () => {
  const contact = {
    id: '55',
    name: 'Ali',
    custom_fields_values: [
      { field_code: 'PHONE', values: [{ value: '+998901112233' }] },
      { field_code: 'EMAIL', values: [{ value: 'ali@example.uz' }] },
    ],
  };

  it('upserts a new contact by its amoCRM id', async () => {
    await processAmoCRMWebhook({ rawPayload: { contacts: { add: [contact] } } }, 'tenant-1');

    expect(findLegacyContact).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', amocrmId: null, OR: [{ phone: '+998901112233' }, { email: 'ali@example.uz' }] },
      orderBy: { updatedAt: 'desc' },
    });
    expect(upsertContact).toHaveBeenCalledWith({
      where: { tenantId_amocrmId: { tenantId: 'tenant-1', amocrmId: '55' } },
      create: {
        tenantId: 'tenant-1',
        amocrmId: '55',
        name: 'Ali',
        phone: '+998901112233',
        email: 'ali@example.uz',
        externalIds: { amocrm_id: '55' },
        metadata: contact,
      },
      update: { name: 'Ali', phone: '+998901112233', email: 'ali@example.uz', metadata: contact },
    });
  });

  it('adopts a legacy contact matched by phone', async () => {
    findLegacyContact.mockResolvedValue({ id: 'c-old', name: 'Old', phone: '+1', email: 'old@x', externalIds: { crm: 'x' } });

    await processAmoCRMWebhook({ rawPayload: { contacts: [{ id: 56, phone: [{ value: '+1' }] }] } }, 'tenant-1');

    expect(updateContact).toHaveBeenCalledWith({
      where: { id: 'c-old' },
      data: {
        amocrmId: '56',
        name: 'Old',
        phone: '+1',
        email: 'old@x',
        externalIds: { crm: 'x', amocrm_id: '56' },
        metadata: { id: 56, phone: [{ value: '+1' }] },
      },
    });
    expect(upsertContact).not.toHaveBeenCalled();
  });

  it('falls back to the upsert when a concurrent delivery already adopted the contact', async () => {
    findLegacyContact.mockResolvedValue({ id: 'c-old', name: null, phone: '+1', email: null, externalIds: null });
    updateContact.mockRejectedValue({ code: 'P2002' });

    await processAmoCRMWebhook({ rawPayload: { contacts: [{ id: '57', email: [{ value: 'e@x' }] }] } }, 'tenant-1');

    expect(upsertContact).toHaveBeenCalledTimes(1);
  });

  it('updates an existing contact keeping its other external ids', async () => {
    findContact.mockResolvedValue({ id: 'c-1', externalIds: { other: '1' } });

    await processAmoCRMWebhook({ rawPayload: { contacts: [{ id: '55' }] } }, 'tenant-1');

    expect(findLegacyContact).not.toHaveBeenCalled();
    expect(upsertContact).toHaveBeenCalledWith(expect.objectContaining({
      update: { externalIds: { other: '1', amocrm_id: '55' }, metadata: { id: '55' } },
    }));
  });

  it('skips contacts without an id', async () => {
    await processAmoCRMWebhook({ rawPayload: { contacts: [{ name: 'x' }, { id: '  ' }, null] } }, 'tenant-1');

    expect(findContact).not.toHaveBeenCalled();
    expect(upsertContact).not.toHaveBeenCalled();
  });
});

describe('processAmoCRMWebhook notification', () => {
  it('queues a telegram notification when leads arrive and a chat is configured', async () => {
    findTelegramIntegration.mockResolvedValue({ id: 'tg' });
    findTenant.mockResolvedValue({ settings: { notificationChatId: ' 12345 ' } });

    await processAmoCRMWebhook({ rawPayload: { leads: [formLead], contacts: [{ id: '1' }] } }, 'tenant-1');

    expect(findTelegramIntegration).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1', type: 'telegram', status: 'active' } });
    expect(createNotification).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        type: 'telegram',
        payload: { chatId: '12345', text: 'AmoCRM update received: 1 lead(s), 1 contact(s).' },
        status: 'pending',
      },
    });
    expect(addNotificationJob).toHaveBeenCalledWith('n-1', { priority: 2 });
  });

  it('sends nothing without leads, a chat id or a telegram integration', async () => {
    findTelegramIntegration.mockResolvedValue({ id: 'tg' });
    findTenant.mockResolvedValue({ settings: { notificationChatId: '1' } });
    await processAmoCRMWebhook({ rawPayload: { contacts: [] } }, 'tenant-1');

    findTenant.mockResolvedValue({ settings: [] });
    await processAmoCRMWebhook({ rawPayload: { leads: [formLead] } }, 'tenant-1');

    findTelegramIntegration.mockResolvedValue(null);
    findTenant.mockResolvedValue({ settings: { notificationChatId: '1' } });
    await processAmoCRMWebhook({ rawPayload: { leads: [formLead] } }, 'tenant-1');

    expect(createNotification).not.toHaveBeenCalled();
  });
});
