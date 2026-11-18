import type { InMemoryPrisma } from '../../../../__tests__/helpers/in-memory-prisma';
import { contextFor, createMoneyFixture, type MoneyFixture } from '../../../../__tests__/helpers/money-fixtures';
import { integrationsRouter } from '../index';

let mockStore: InMemoryPrisma;

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual('@dashboarduz/db'),
  forTenant: () => mockStore.client(),
}));

let fixture: MoneyFixture;

beforeEach(() => {
  fixture = createMoneyFixture();
  mockStore = fixture.store;
  fixture.store.seed('Integration', [
    {
      tenantId: fixture.tenantId,
      type: 'telegram',
      status: 'active',
      config: { webhookSecret: 'tg-secret', webhookUrl: 'https://api/webhooks/telegram', reportRecipients: ['1'] },
      tokensEncrypted: 'enc:bot-token',
      refreshToken: 'enc:refresh',
    },
    { tenantId: fixture.tenantId, type: 'faceid_attendance', status: 'active', config: { webhookTokenHash: 'hash', webhookUrl: 'https://api/webhooks/faceid' } },
  ]);
});

const admin = () => integrationsRouter.createCaller(contextFor(fixture, fixture.adminId, ['Admin']));

describe('integrations.list and getByType', () => {
  it('return the fields the page uses, never tokens or webhook secrets', async () => {
    const list = await admin().list();
    const telegram = list.find((integration) => integration.type === 'telegram')!;

    expect(telegram).not.toHaveProperty('tokensEncrypted');
    expect(telegram).not.toHaveProperty('refreshToken');
    expect(telegram).toMatchObject({ status: 'active', config: { webhookUrl: 'https://api/webhooks/telegram', reportRecipients: ['1'] } });
    expect(telegram.config).not.toHaveProperty('webhookSecret');
    expect(list.find((integration) => integration.type === 'faceid_attendance')!.config).toEqual({ webhookUrl: 'https://api/webhooks/faceid' });
    expect(JSON.stringify(list)).not.toMatch(/tg-secret|enc:|hash/);

    const byType = await admin().getByType({ type: 'telegram' });

    expect(JSON.stringify(byType)).not.toMatch(/tg-secret|enc:/);
    await expect(admin().getByType({ type: 'amocrm' })).resolves.toBeNull();
  });
});
