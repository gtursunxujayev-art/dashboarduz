import { TRPCError } from '@trpc/server';
import { request, response } from 'express';

import { hashFaceIdWebhookToken } from '../../../services/attendance/faceid';
import type { Context } from '../../context';
import { router } from '../../trpc';
import { faceIdIntegrationProcedures } from '../integrations/faceid';
import { faceIdMappingProcedures } from '../integrations/faceid-mappings';

// Face ID integration admin procedures: connect (webhook token stored as a SHA-256 hash), settings, token
// rotation, status/health counters and the external-user mappings used by attendance matching.
const mockDb = {
  user: { findFirst: jest.fn(), findMany: jest.fn() },
  integration: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  webhookEvent: { count: jest.fn(), findMany: jest.fn() },
  attendanceEvent: { count: jest.fn() },
  attendanceDaySummary: { count: jest.fn() },
  auditLog: { create: jest.fn() },
};

jest.mock('@dashboarduz/db', () => ({
  get systemPrisma() {
    return mockDb;
  },
  forTenant: () => mockDb,
}));
jest.mock('../../../services/security/encryption', () => ({
  encryptIntegrationTokens: (tokens: Record<string, unknown>) => `encrypted:${JSON.stringify(tokens)}`,
}));

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_USER_ID = '44444444-4444-4444-8444-444444444444';

const testRouter = router({ ...faceIdIntegrationProcedures, ...faceIdMappingProcedures });

function adminCaller() {
  const ctx: Context = { req: request, res: response, user: { userId: ADMIN_ID, tenantId: TENANT_ID, roles: ['Admin'] }, tenantId: TENANT_ID };

  return testRouter.createCaller(ctx);
}

async function rejection(promise: Promise<unknown>): Promise<TRPCError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TRPCError) return error;
    throw error;
  }
  throw new Error('Expected the procedure to throw');
}

const savedEnv = { ...process.env };

beforeEach(() => {
  jest.resetAllMocks();
  process.env = { ...savedEnv, PUBLIC_API_URL: 'https://api.example.uz' };
  // protectedProcedure's active-user check
  mockDb.user.findFirst.mockImplementation((args: { where: { isActive?: boolean } }) => Promise.resolve(args.where.isActive ? { id: ADMIN_ID } : null));
  mockDb.auditLog.create.mockResolvedValue({});
  mockDb.integration.update.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id }));
});

afterAll(() => {
  process.env = savedEnv;
});

describe('connectFaceId / updateFaceIdSettings / rotateFaceIdToken', () => {
  it('connects with the given token, storing only its hash in the config', async () => {
    mockDb.integration.upsert.mockResolvedValue({ id: 'fid-1' });

    const result = await adminCaller().connectFaceId({ webhookToken: 'secret-token', branchWhitelist: ['Chilonzor', 'chilonzor '], unmatchedUserPolicy: 'ignore' });

    expect(result.connection).toMatchObject({
      verified: true,
      webhookUrl: 'https://api.example.uz/webhooks/faceid',
      webhookToken: 'secret-token',
      branchWhitelist: ['Chilonzor'],
      unmatchedUserPolicy: 'ignore',
    });
    const { create, update } = mockDb.integration.upsert.mock.calls[0][0];

    expect(create).toMatchObject({
      tenantId: TENANT_ID,
      type: 'faceid_attendance',
      status: 'active',
      tokensEncrypted: 'encrypted:{"webhookToken":"secret-token"}',
      config: { enabled: true, webhookTokenHash: hashFaceIdWebhookToken('secret-token'), branchWhitelist: ['Chilonzor'], unmatchedUserPolicy: 'ignore' },
    });
    expect(update.errorMessage).toBeNull();
    expect(mockDb.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'integration_connect', resourceId: 'fid-1', metadata: { type: 'faceid_attendance' } });
  });

  it('generates a token when none is given', async () => {
    mockDb.integration.upsert.mockResolvedValue({ id: 'fid-1' });

    const result = await adminCaller().connectFaceId({});

    expect(result.connection.webhookToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.connection).toMatchObject({ branchWhitelist: [], unmatchedUserPolicy: 'store' });
  });

  it('updates the branch whitelist and keeps the stored policy when none is given', async () => {
    mockDb.integration.findUnique.mockResolvedValue({ id: 'fid-1', config: { webhookUrl: 'https://old/webhooks/faceid', unmatchedUserPolicy: 'ignore', webhookTokenHash: 'h' } });

    expect(await adminCaller().updateFaceIdSettings({ branchWhitelist: [' Yunusobod '] }))
      .toEqual({ success: true, branchWhitelist: ['Yunusobod'], unmatchedUserPolicy: 'ignore' });
    expect(mockDb.integration.update.mock.calls[0][0].data.config).toMatchObject({
      webhookUrl: 'https://old/webhooks/faceid', webhookTokenHash: 'h', branchWhitelist: ['Yunusobod'], unmatchedUserPolicy: 'ignore',
    });
    expect(mockDb.auditLog.create.mock.calls[0][0].data.metadata).toMatchObject({ type: 'faceid_attendance', action: 'update_settings' });

    mockDb.integration.findUnique.mockResolvedValue(null);
    expect(await rejection(adminCaller().updateFaceIdSettings({})))
      .toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Face ID integration is not connected.' });
  });

  it('rotates the webhook token, replacing the stored hash', async () => {
    mockDb.integration.findUnique.mockResolvedValue({ id: 'fid-1', config: { webhookTokenHash: 'old', branchWhitelist: ['A'] } });

    const result = await adminCaller().rotateFaceIdToken({});

    expect(result).toMatchObject({ success: true, webhookUrl: 'https://api.example.uz/webhooks/faceid' });
    const { data } = mockDb.integration.update.mock.calls[0][0];

    expect(data).toMatchObject({ status: 'active', errorMessage: null, tokensEncrypted: `encrypted:{"webhookToken":"${result.webhookToken}"}` });
    expect(data.config).toMatchObject({ webhookTokenHash: hashFaceIdWebhookToken(result.webhookToken), branchWhitelist: ['A'] });
    expect(mockDb.auditLog.create.mock.calls[0][0].data.metadata).toEqual({ type: 'faceid_attendance', action: 'rotate_webhook_token' });

    mockDb.integration.findUnique.mockResolvedValue(null);
    expect((await rejection(adminCaller().rotateFaceIdToken({}))).code).toBe('PRECONDITION_FAILED');
  });
});

describe('getFaceIdStatus', () => {
  it('reports health counters for a connected integration', async () => {
    mockDb.integration.findUnique.mockResolvedValue({
      status: 'active',
      config: { webhookUrl: 'https://api/webhooks/faceid', branchWhitelist: ['A', 'a'], unmatchedUserPolicy: 'ignore', lastValidatedAt: '2026-11-01T00:00:00.000Z' },
      lastSyncAt: new Date('2026-11-18T00:00:00.000Z'),
      tokensEncrypted: 'enc',
    });
    mockDb.webhookEvent.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1).mockResolvedValueOnce(40);
    mockDb.attendanceEvent.count.mockResolvedValueOnce(30).mockResolvedValueOnce(4);
    mockDb.attendanceDaySummary.count.mockResolvedValue(3);
    mockDb.webhookEvent.findMany.mockResolvedValue([
      { id: 'w1', createdAt: new Date('2026-11-18T01:00:00.000Z'), errorMessage: 'No active Face ID integration found', eventType: 'check_in_out' },
    ]);

    expect(await adminCaller().getFaceIdStatus()).toEqual({
      connected: true,
      webhookUrl: 'https://api/webhooks/faceid',
      hasToken: true,
      branchWhitelist: ['A'],
      unmatchedUserPolicy: 'ignore',
      lastSyncAt: '2026-11-18T00:00:00.000Z',
      lastValidatedAt: '2026-11-01T00:00:00.000Z',
      health: {
        webhookPending: 2,
        webhookFailedLast24h: 1,
        webhookProcessedLast24h: 40,
        eventsLast7d: 30,
        unmatchedEventsLast7d: 4,
        matchedEventsLast7d: 26,
        anomaliesLast7d: 3,
      },
      recentWebhookErrors: [{ id: 'w1', createdAt: '2026-11-18T01:00:00.000Z', errorMessage: 'No active Face ID integration found', eventType: 'check_in_out' }],
    });
  });

  it('returns a disconnected state with the webhook URL to configure', async () => {
    mockDb.integration.findUnique.mockResolvedValue(null);

    const status = await adminCaller().getFaceIdStatus();

    expect(status).toMatchObject({ connected: false, webhookUrl: 'https://api.example.uz/webhooks/faceid', hasToken: false, lastSyncAt: null });
    expect(mockDb.webhookEvent.count).not.toHaveBeenCalled();
  });
});

describe('Face ID user mappings', () => {
  it('lists mappings with the mapped users, sorted by external id', async () => {
    mockDb.integration.findUnique.mockResolvedValue({ config: { userExternalMap: { 9: USER_ID, 10: OTHER_USER_ID } } });
    mockDb.user.findMany.mockResolvedValue([{ id: USER_ID, name: 'Ali', phone: '998901112233', isActive: true }]);

    expect(await adminCaller().getFaceIdMappings()).toEqual({
      connected: true,
      mappings: [
        { externalUserId: '10', userId: OTHER_USER_ID, userName: null, userPhone: null, userActive: false },
        { externalUserId: '9', userId: USER_ID, userName: 'Ali', userPhone: '998901112233', userActive: true },
      ],
    });

    mockDb.integration.findUnique.mockResolvedValue(null);
    expect(await adminCaller().getFaceIdMappings()).toEqual({ connected: false, mappings: [] });
  });

  it('maps an external id to a user, refusing to remap it to someone else', async () => {
    mockDb.integration.findUnique.mockResolvedValue({ id: 'fid-1', config: { userExternalMap: { 7: OTHER_USER_ID }, branchWhitelist: ['A'] } });
    mockDb.user.findFirst.mockImplementation((args: { where: { isActive?: boolean } }) => Promise.resolve(args.where.isActive ? { id: ADMIN_ID } : { id: USER_ID }));

    expect(await adminCaller().upsertFaceIdMapping({ externalUserId: ' 8 ', userId: USER_ID })).toEqual({ success: true, externalUserId: '8', userId: USER_ID });
    expect(mockDb.integration.update.mock.calls[0][0].data.config).toMatchObject({
      branchWhitelist: ['A'],
      userExternalMap: { 7: OTHER_USER_ID, 8: USER_ID },
    });

    expect(await rejection(adminCaller().upsertFaceIdMapping({ externalUserId: '7', userId: USER_ID })))
      .toMatchObject({ code: 'CONFLICT', message: 'This external Face ID user is already mapped to another user.' });
  });

  it('needs the user to belong to the tenant', async () => {
    mockDb.integration.findUnique.mockResolvedValue({ id: 'fid-1', config: {} });

    expect(await rejection(adminCaller().upsertFaceIdMapping({ externalUserId: '8', userId: USER_ID })))
      .toMatchObject({ code: 'NOT_FOUND', message: 'Selected user not found in this tenant.' });
  });

  it('removes a mapping, and reports when there was none', async () => {
    mockDb.integration.findUnique.mockResolvedValue({ id: 'fid-1', config: { userExternalMap: { 7: USER_ID, 8: OTHER_USER_ID } } });

    expect(await adminCaller().removeFaceIdMapping({ externalUserId: '7' })).toEqual({ success: true, removed: true });
    expect(mockDb.integration.update.mock.calls[0][0].data.config.userExternalMap).toEqual({ 8: OTHER_USER_ID });
    expect(mockDb.auditLog.create.mock.calls[0][0].data.metadata).toEqual({ type: 'faceid_attendance', action: 'remove_user_external_map', externalUserId: '7' });

    expect(await adminCaller().removeFaceIdMapping({ externalUserId: '99' })).toEqual({ success: true, removed: false });
    expect(mockDb.integration.update).toHaveBeenCalledTimes(1);
  });
});
