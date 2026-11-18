import { systemPrisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { request, response } from 'express';

import { verifyPassword } from '../../../services/auth/password';
import {
  amoFailureHelp,
  amoFailureMessage,
  detectAmoFailureReason,
  fetchAmoCRMAccountByToken,
  getPublicApiBaseUrl,
  normalizeBaseUrl,
  upsertActiveIntegration,
} from '../../../services/integration-settings/connection';
import {
  buildFaceIdWebhookToken,
  normalizeBranchWhitelist,
  normalizeUnmatchedUserPolicy,
  parseFaceIdUserExternalMap,
  requireFaceIdIntegration,
  saveFaceIdConfig,
} from '../../../services/integration-settings/faceid';
import {
  generatePassword,
  generateUniqueLogin,
  isTelegramMappingConflictError,
  rolesNeedManagerMapping,
  validateNormalizedPhoneOrThrow,
  withTelegramMappingConflict,
} from '../../../services/users/accounts';
import type { Context } from '../../context';
import { usersRouter } from '../users';

// The users admin procedures (create, rename, roles, credentials, activate, directory lists) through
// createCaller with a mocked database, plus the shared account and integration-settings helpers they use.
const mockLookup = jest.fn();
const mockDb = {
  user: {
    // protectedProcedure's active-user check asks with isActive: true; every other lookup goes to mockLookup.
    findFirst: jest.fn((args: { where: { isActive?: boolean } }) => (
      args.where.isActive === true ? Promise.resolve({ id: ACTOR_ID }) : mockLookup(args)
    )),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  integration: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  telegramRecipient: { findMany: jest.fn() },
  auditLog: { create: jest.fn() },
};
const mockAmoContext = jest.fn();
const mockAmoReference = jest.fn();

jest.mock('@dashboarduz/db', () => ({
  get systemPrisma() {
    return mockDb;
  },
  forTenant: () => mockDb,
}));
jest.mock('../../../services/integrations/amocrm-live', () => ({
  getTenantAmoCRMContext: (...args: unknown[]) => mockAmoContext(...args),
}));
jest.mock('../../../services/integrations/amocrm-activity-snapshot-read', () => ({
  getAmoReference: (...args: unknown[]) => mockAmoReference(...args),
}));

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const TARGET_ID = '33333333-3333-4333-8333-333333333333';

function caller(roles: Array<'Admin' | 'Manager' | 'Agent'> = ['Admin']) {
  const ctx: Context = {
    req: request,
    res: response,
    user: { userId: ACTOR_ID, tenantId: TENANT_ID, roles },
    tenantId: TENANT_ID,
  };

  return usersRouter.createCaller(ctx);
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

beforeEach(() => {
  mockLookup.mockReset();
  mockDb.user.findMany.mockReset();
  mockDb.user.create.mockReset();
  mockDb.user.update.mockReset();
  mockDb.integration.findUnique.mockReset();
  mockDb.integration.upsert.mockReset();
  mockDb.integration.update.mockReset();
  mockDb.telegramRecipient.findMany.mockReset();
  mockDb.auditLog.create.mockReset();
  mockDb.auditLog.create.mockResolvedValue({});
  mockAmoContext.mockReset();
  mockAmoReference.mockReset();
  mockDb.user.findFirst.mockClear();
});

describe('users.create', () => {
  it('creates an agent with a generated login and password, its amoCRM mapping and Telegram chat', async () => {
    // generateUniqueLogin: the first candidate is free; then no other user has the phone.
    mockLookup.mockResolvedValue(null);
    mockDb.user.create.mockImplementation(({ data }: { data: { username: string } }) => Promise.resolve({
      id: TARGET_ID, username: data.username, name: 'Ali Valiyev', roles: ['Agent'],
    }));

    const result = await caller(['Manager']).create({
      name: ' Ali Valiyev ', phone: '+998 90 111 22 33', role: 'Agent', amocrmResponsibleUserId: '501', telegramChatId: '1001',
    });

    expect(result.credentials.login).toMatch(/^ali-valiyev\.[0-9a-f]{4}$/);
    expect(result.credentials.password).toMatch(/^[A-Za-z2-9]{12}$/);
    expect(result.user).toEqual({ id: TARGET_ID, username: result.credentials.login, name: 'Ali Valiyev', roles: ['Agent'] });
    const { data } = mockDb.user.create.mock.calls[0][0];

    expect(data).toMatchObject({
      tenantId: TENANT_ID,
      name: 'Ali Valiyev',
      phone: '998901112233',
      username: result.credentials.login,
      authProvider: 'email',
      roles: ['Agent'],
      amocrmResponsibleUserId: '501',
      telegramId: '1001',
    });
    expect(await verifyPassword(result.credentials.password, data.passwordHash)).toBe(true);
    expect(mockDb.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'user_create',
      resourceId: TARGET_ID,
      metadata: { role: 'Agent', phone: '998901112233', amocrmResponsibleUserId: '501', telegramChatId: '1001' },
    });
  });

  it('requires an amoCRM mapping for agents and rejects a phone already in use', async () => {
    mockLookup.mockResolvedValue(null);
    expect(await rejection(caller().create({ role: 'Agent' }))).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'AmoCRM manager mapping is required for Agent/OnlineAgent/OfflineAgent/TeamLeader users.',
    });

    // Login check: free; phone check: taken.
    mockLookup.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'someone' });
    expect(await rejection(caller().create({ role: 'Finance', phone: '998901112233' }))).toMatchObject({
      code: 'CONFLICT',
      message: 'Bu telefon raqam boshqa foydalanuvchiga biriktirilgan.',
    });
    expect(mockDb.user.create).not.toHaveBeenCalled();
  });

  it('turns a Telegram mapping clash into CONFLICT and refuses agents', async () => {
    mockLookup.mockResolvedValue(null);
    mockDb.user.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed on telegramId'), { code: 'P2002' }));

    expect(await rejection(caller().create({ role: 'Finance', telegramChatId: '1001' }))).toMatchObject({
      code: 'CONFLICT',
      message: 'Tanlangan Telegram foydalanuvchisi allaqachon boshqa akkauntga biriktirilgan.',
    });
    expect(await rejection(caller(['Agent']).create({ role: 'Finance' }))).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('users.updateName / setActive', () => {
  it('renames a user and normalizes the phone, auditing old and new values', async () => {
    mockLookup.mockResolvedValueOnce({ id: TARGET_ID, name: 'Old', phone: null }).mockResolvedValueOnce(null);
    mockDb.user.update.mockResolvedValue({ id: TARGET_ID, name: 'New' });

    await caller(['Manager']).updateName({ userId: TARGET_ID, name: ' New ', phone: '90 111 22 33' });

    expect(mockDb.user.update.mock.calls[0][0]).toMatchObject({ where: { id: TARGET_ID }, data: { name: 'New', phone: '901112233' } });
    expect(mockDb.auditLog.create.mock.calls[0][0].data.metadata).toEqual({
      previousName: 'Old', nextName: 'New', previousPhone: null, nextPhone: '901112233',
    });
  });

  it('rejects an unknown user, a short phone and a phone of another user', async () => {
    mockLookup.mockResolvedValueOnce(null);
    expect(await rejection(caller().updateName({ userId: TARGET_ID }))).toMatchObject({ code: 'NOT_FOUND', message: 'User not found' });

    mockLookup.mockResolvedValueOnce({ id: TARGET_ID, name: null, phone: null });
    expect((await rejection(caller().updateName({ userId: TARGET_ID, phone: '1234' }))).code).toBe('BAD_REQUEST');

    mockLookup.mockResolvedValueOnce({ id: TARGET_ID, name: null, phone: null }).mockResolvedValueOnce({ id: 'other' });
    expect((await rejection(caller().updateName({ userId: TARGET_ID, phone: '998901112233' }))).code).toBe('CONFLICT');
  });

  it('deactivates another user, skips a no-op and refuses self-deactivation', async () => {
    mockLookup.mockResolvedValueOnce({ id: TARGET_ID, isActive: true, name: null, username: 'ali' });
    mockDb.user.update.mockResolvedValue({ id: TARGET_ID, isActive: false });

    expect(await caller().setActive({ userId: TARGET_ID, isActive: false })).toEqual({ success: true, user: { id: TARGET_ID, isActive: false } });
    expect(mockDb.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'user_deactivate',
      metadata: { previousIsActive: true, nextIsActive: false, targetLabel: 'ali' },
    });

    mockLookup.mockResolvedValueOnce({ id: TARGET_ID, isActive: true, name: 'Ali', username: 'ali' });
    expect(await caller().setActive({ userId: TARGET_ID, isActive: true })).toEqual({ success: true, user: { id: TARGET_ID, isActive: true } });
    expect(mockDb.user.update).toHaveBeenCalledTimes(1);

    expect(await rejection(caller().setActive({ userId: ACTOR_ID, isActive: false })))
      .toMatchObject({ code: 'BAD_REQUEST', message: "O'zingizni deaktivatsiya qila olmaysiz." });
    mockLookup.mockResolvedValueOnce(null);
    expect((await rejection(caller().setActive({ userId: TARGET_ID, isActive: true }))).code).toBe('NOT_FOUND');
    expect((await rejection(caller(['Manager']).setActive({ userId: TARGET_ID, isActive: true }))).code).toBe('FORBIDDEN');
  });
});

describe('users.updateRole / updateCredentials', () => {
  it('keeps the existing amoCRM mapping when roles change without a new one', async () => {
    mockLookup.mockResolvedValueOnce({ id: TARGET_ID }).mockResolvedValueOnce({ amocrmResponsibleUserId: '777' });
    mockDb.user.update.mockResolvedValue({ id: TARGET_ID, roles: ['OnlineAgent'] });

    await caller(['Manager']).updateRole({ userId: TARGET_ID, roles: ['OnlineAgent'] });

    expect(mockDb.user.update.mock.calls[0][0].data).toEqual({ roles: ['OnlineAgent'], amocrmResponsibleUserId: '777', telegramId: null });
    expect(mockDb.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'user_role_update', metadata: { roles: ['OnlineAgent'] } });
  });

  it('does not touch the mapping for roles that need none', async () => {
    mockLookup.mockResolvedValueOnce({ id: TARGET_ID });
    mockDb.user.update.mockResolvedValue({ id: TARGET_ID });

    await caller().updateRole({ userId: TARGET_ID, roles: ['Finance'], telegramChatId: '55' });

    expect(mockDb.user.update.mock.calls[0][0].data).toEqual({ roles: ['Finance'], telegramId: '55' });
    mockLookup.mockResolvedValueOnce(null);
    expect((await rejection(caller().updateRole({ userId: TARGET_ID, roles: ['Finance'] }))).code).toBe('NOT_FOUND');
  });

  it('changes the login after a cross-tenant check and generates a password on request', async () => {
    mockLookup.mockResolvedValueOnce({ id: TARGET_ID, username: 'old' }).mockResolvedValueOnce(null);
    mockDb.user.update.mockResolvedValue({ id: TARGET_ID, username: 'fresh' });

    const result = await caller().updateCredentials({ userId: TARGET_ID, username: ' Fresh ', generatePassword: true });

    expect(mockLookup).toHaveBeenLastCalledWith({ where: { username: 'fresh', NOT: { id: TARGET_ID } }, select: { id: true } });
    expect(result.generatedPassword).toMatch(/^[A-Za-z2-9]{12}$/);
    const { data } = mockDb.user.update.mock.calls[0][0];

    expect(data.username).toBe('fresh');
    expect(await verifyPassword(result.generatedPassword ?? '', data.passwordHash)).toBe(true);
    expect(mockDb.auditLog.create.mock.calls[0][0].data.metadata).toEqual({ usernameUpdated: true, passwordUpdated: true });
  });

  it('rejects a taken login, nothing to change and an unknown user', async () => {
    mockLookup.mockResolvedValueOnce({ id: TARGET_ID, username: 'old' }).mockResolvedValueOnce({ id: 'other' });
    expect(await rejection(caller().updateCredentials({ userId: TARGET_ID, username: 'taken' })))
      .toMatchObject({ code: 'CONFLICT', message: 'Login already in use.' });

    mockLookup.mockResolvedValueOnce({ id: TARGET_ID, username: 'old' });
    expect(await rejection(caller().updateCredentials({ userId: TARGET_ID })))
      .toMatchObject({ code: 'BAD_REQUEST', message: 'No credentials to update.' });

    mockLookup.mockResolvedValueOnce(null);
    expect((await rejection(caller().updateCredentials({ userId: TARGET_ID, password: 'long-enough' }))).code).toBe('NOT_FOUND');
  });
});

describe('users directory', () => {
  it('lists amoCRM managers by name, dropping users without an id', async () => {
    mockAmoContext.mockResolvedValue({ integrationId: 'amo-1', accessToken: 't', config: {}, selectedPipelineIds: null });
    mockAmoReference.mockResolvedValue([
      { id: 2, name: 'Zafar', is_active: false },
      { id: 1, login: 'ali@x.uz', email: 'ali@x.uz' },
      { name: 'No id' },
    ]);

    expect(await caller(['Manager']).amocrmManagers()).toEqual([
      { id: '1', name: 'ali@x.uz', email: 'ali@x.uz', isActive: true },
      { id: '2', name: 'Zafar', email: null, isActive: false },
    ]);

    mockAmoContext.mockResolvedValue(null);
    expect(await rejection(caller().amocrmManagers())).toMatchObject({ code: 'PRECONDITION_FAILED', message: 'AmoCRM integration is not connected.' });
  });

  it('lists started Telegram recipients, or nothing without an active integration', async () => {
    mockDb.integration.findUnique.mockResolvedValueOnce({ id: 'tg-1', status: 'active' });
    mockDb.telegramRecipient.findMany.mockResolvedValue([{
      chatId: '42', username: 'ali', firstName: 'Ali', lastName: null, displayName: 'Ali', started: true,
      selectedForReports: false, startedAt: null, lastSeenAt: new Date('2026-11-18T00:00:00Z'),
    }]);

    expect(await caller(['Manager']).telegramRecipients()).toEqual([
      { id: '42', name: 'Ali', username: 'ali', lastSeenAt: '2026-11-18T00:00:00.000Z' },
    ]);

    mockDb.integration.findUnique.mockResolvedValueOnce(null);
    expect(await caller().telegramRecipients()).toEqual([]);
  });

  it('lists the tenant users oldest first', async () => {
    mockDb.user.findMany.mockResolvedValue([{ id: TARGET_ID }]);

    expect(await caller().list()).toEqual([{ id: TARGET_ID }]);
    expect(mockDb.user.findMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: TENANT_ID }, orderBy: { createdAt: 'asc' } });
  });
});

describe('user account helpers', () => {
  it('detects roles that need an amoCRM mapping and Telegram mapping clashes', () => {
    expect(rolesNeedManagerMapping(['Finance', 'TeamLeader'])).toBe(true);
    expect(rolesNeedManagerMapping(['Admin', 'Finance'])).toBe(false);
    expect(isTelegramMappingConflictError({ code: 'P2002', message: 'Unique on telegramId' })).toBe(true);
    expect(isTelegramMappingConflictError(new Error('violates users_telegramid_key'))).toBe(true);
    expect(isTelegramMappingConflictError({ code: 'P2002', message: 'username' })).toBe(false);
  });

  it('passes other errors and results through withTelegramMappingConflict', async () => {
    await expect(withTelegramMappingConflict(() => Promise.resolve(5))).resolves.toBe(5);
    await expect(withTelegramMappingConflict(() => Promise.reject(new Error('db down')))).rejects.toThrow('db down');
  });

  it('normalizes phones to 9-15 digits', () => {
    expect(validateNormalizedPhoneOrThrow(undefined)).toBeNull();
    expect(validateNormalizedPhoneOrThrow('+998 (90) 111-22-33')).toBe('998901112233');
    expect(() => validateNormalizedPhoneOrThrow('12345678')).toThrow('Telefon raqam noto‘g‘ri formatda. 9-15 ta raqam kiriting.');
    expect(() => validateNormalizedPhoneOrThrow('1234567890123456')).toThrow(TRPCError);
  });

  it('generates passwords from an unambiguous alphabet and unique logins', async () => {
    expect(generatePassword(30)).toMatch(/^[A-HJ-NP-Za-km-z2-9]{30}$/);

    mockLookup.mockResolvedValue({ id: 'taken' });
    const fallback = await generateUniqueLogin('!!!');

    // Every random candidate was taken: falls back to a timestamp suffix after 20 tries.
    expect(fallback).toMatch(/^user\.\d{13}$/);
    expect(mockLookup).toHaveBeenCalledTimes(20);
  });
});

describe('integration settings helpers', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('classifies amoCRM failures and words help for them', () => {
    expect(detectAmoFailureReason(new Error('Failed to decrypt integration tokens'))).toBe('decrypt_failed');
    expect(detectAmoFailureReason(new Error('The operation was aborted'))).toBe('network_timeout');
    expect(detectAmoFailureReason(new Error('Request failed 401'))).toBe('token_invalid');
    expect(detectAmoFailureReason(new Error('Forbidden'))).toBe('token_invalid');
    expect(detectAmoFailureReason('weird')).toBe('amo_unavailable');
    expect(amoFailureMessage('Sync failed', 'token_invalid')).toBe('Sync failed (token_invalid)');
    expect(amoFailureHelp('decrypt_failed')).toContain('Tokenni qayta ulash kerak');
    expect(amoFailureHelp('token_invalid')).toContain('Token eskirgan');
    expect(amoFailureHelp('network_timeout')).toBe('Tarmoq kechikishi kuzatildi. Qayta urining.');
    expect(amoFailureHelp('amo_unavailable')).toBeNull();
  });

  it('resolves the public API base URL from env', () => {
    expect(normalizeBaseUrl('https://a.uz///')).toBe('https://a.uz');
    expect(normalizeBaseUrl()).toBeNull();

    process.env.PUBLIC_API_URL = 'https://api.example.uz/';
    expect(getPublicApiBaseUrl()).toBe('https://api.example.uz');
    delete process.env.PUBLIC_API_URL;
    delete process.env.API_URL;
    process.env.RAILWAY_PUBLIC_DOMAIN = 'svc.up.railway.app/';
    expect(getPublicApiBaseUrl()).toBe('https://svc.up.railway.app');
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    process.env.PORT = '4000';
    expect(getPublicApiBaseUrl()).toBe('http://localhost:4000');
  });

  it('validates an amoCRM token against the account endpoint', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    try {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ id: 3141, subdomain: 'acme' }), { status: 200 }));
      expect(await fetchAmoCRMAccountByToken('tok', 'https://acme.amocrm.ru')).toEqual({ id: 3141, subdomain: 'acme' });
      expect(fetchSpy).toHaveBeenNthCalledWith(1, 'https://acme.amocrm.ru/api/v4/account', expect.objectContaining({
        headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      }));

      fetchSpy.mockResolvedValueOnce(new Response('no', { status: 401 }));
      expect(await rejection(fetchAmoCRMAccountByToken('bad', 'https://acme.amocrm.ru'))).toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Failed to validate AmoCRM long-lived token (401) (token_invalid)',
      });

      fetchSpy.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      expect(await rejection(fetchAmoCRMAccountByToken('slow', 'https://acme.amocrm.ru'))).toMatchObject({
        code: 'TIMEOUT',
        message: 'Failed to validate AmoCRM long-lived token (network_timeout)',
      });

      fetchSpy.mockRejectedValueOnce(new Error('ENOTFOUND'));
      await expect(fetchAmoCRMAccountByToken('x', 'https://nowhere')).rejects.toThrow('ENOTFOUND');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('upserts an active integration and audits the connect', async () => {
    mockDb.integration.upsert.mockResolvedValue({ id: 'int-1' });

    await upsertActiveIntegration({
      db: systemPrisma,
      tenantId: TENANT_ID,
      type: 'telegram',
      data: { config: { a: 1 } },
      clearError: true,
      connectAudit: { actorUserId: ACTOR_ID, metadata: { type: 'telegram' } },
    });

    expect(mockDb.integration.upsert).toHaveBeenCalledWith({
      where: { tenantId_type: { tenantId: TENANT_ID, type: 'telegram' } },
      update: { status: 'active', config: { a: 1 }, errorMessage: null },
      create: { tenantId: TENANT_ID, type: 'telegram', status: 'active', config: { a: 1 } },
    });
    expect(mockDb.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'integration_connect', resourceId: 'int-1', userId: ACTOR_ID });

    await upsertActiveIntegration({ db: systemPrisma, tenantId: TENANT_ID, type: 'meta', data: {}, clearError: false });
    expect(mockDb.integration.upsert.mock.calls[1][0].update).toEqual({ status: 'active' });
    expect(mockDb.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('normalizes Face ID settings and saves its config with an audit row', async () => {
    expect(buildFaceIdWebhookToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(normalizeBranchWhitelist([' Chilonzor ', 'chilonzor', '', 'Yunusobod'])).toEqual(['Chilonzor', 'Yunusobod']);
    expect(normalizeBranchWhitelist(undefined)).toEqual([]);
    expect(normalizeUnmatchedUserPolicy('IGNORE')).toBe('ignore');
    expect(normalizeUnmatchedUserPolicy(null)).toBe('store');
    expect(parseFaceIdUserExternalMap({ userExternalMap: { ' 7 ': ' u1 ', 8: '', '': 'u2' } })).toEqual({ 7: 'u1' });

    mockDb.integration.findUnique.mockResolvedValueOnce({ id: 'fid-1', config: {} }).mockResolvedValueOnce(null);
    expect(await requireFaceIdIntegration(systemPrisma, TENANT_ID)).toEqual({ id: 'fid-1', config: {} });
    expect(await rejection(requireFaceIdIntegration(systemPrisma, TENANT_ID)))
      .toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Face ID integration is not connected.' });

    await saveFaceIdConfig({
      db: systemPrisma, tenantId: TENANT_ID, actorUserId: ACTOR_ID, integrationId: 'fid-1', config: { branchWhitelist: [] }, auditMetadata: { change: 'x' },
    });
    expect(mockDb.integration.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'fid-1' },
      data: { config: { branchWhitelist: [] }, errorMessage: null, lastSyncAt: expect.any(Date) },
    });
    expect(mockDb.auditLog.create.mock.calls[0][0].data.metadata).toEqual({ type: 'faceid_attendance', change: 'x' });
  });
});
