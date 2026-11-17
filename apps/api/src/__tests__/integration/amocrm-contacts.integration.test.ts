/**
 * amoCRM webhook contacts against a real Postgres: contacts are keyed by (tenantId, amocrmId), so repeated or
 * simultaneous deliveries of one amoCRM contact store one row. Skipped unless TEST_DATABASE_URL is set.
 */
import {
  createTestTenant,
  deleteTestTenant,
  describeWithDatabase,
  disconnectDatabase,
  loadPrisma,
} from './harness';

jest.setTimeout(60_000);

type ProcessFn = typeof import('../../workers/processors/amocrm-webhook').processAmoCRMWebhook;

function contactPayload(id: number, name: string, phone: string) {
  return {
    rawPayload: {
      contacts: {
        add: [{ id, name, custom_fields_values: [{ field_code: 'PHONE', values: [{ value: phone }] }] }],
      },
    },
  };
}

describeWithDatabase('amoCRM webhook contacts (Postgres integration)', () => {
  let tenantId: string;
  let processAmoCRMWebhook: ProcessFn;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- loaded after the harness set DATABASE_URL
    processAmoCRMWebhook = (require('../../workers/processors/amocrm-webhook') as typeof import('../../workers/processors/amocrm-webhook')).processAmoCRMWebhook;
    tenantId = (await createTestTenant('amo-contacts')).tenantId;
  });

  afterAll(async () => {
    await loadPrisma().contact.deleteMany({ where: { tenantId } });
    await deleteTestTenant(tenantId);
    await disconnectDatabase();
  });

  it('stores one contact for simultaneous deliveries of the same amoCRM contact', async () => {
    await Promise.all(Array.from({ length: 6 }, (_, i) => processAmoCRMWebhook(contactPayload(7001, `Name ${i}`, '998900000001'), tenantId)));

    const rows = await loadPrisma().contact.findMany({ where: { tenantId, amocrmId: '7001' } });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.externalIds).toMatchObject({ amocrm_id: '7001' });
  });

  it('adopts a contact stored before the key existed (matched by phone) instead of creating a second one', async () => {
    const prisma = loadPrisma();
    const legacy = await prisma.contact.create({
      data: { tenantId, name: 'Legacy', phone: '998900000002', externalIds: { telegram_id: '42' } },
    });

    await processAmoCRMWebhook(contactPayload(7002, 'Updated', '998900000002'), tenantId);

    const rows = await prisma.contact.findMany({ where: { tenantId, phone: '998900000002' } });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: legacy.id, amocrmId: '7002', name: 'Updated' });
    expect(rows[0]!.externalIds).toMatchObject({ telegram_id: '42', amocrm_id: '7002' });
  });
});
