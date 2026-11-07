import { describe, expect, it } from '@jest/globals';

import { getCallsProviderFilter, readCallsSource } from '../../calls-source';
import { noteToCallRow, readCallsSyncState, type CallManager } from '../amocrm-call-sync';

jest.mock('@dashboarduz/db', () => ({ prisma: {} }));
jest.mock('../../cache', () => ({
  buildCacheKey: (prefix: string) => prefix,
  getOrSet: (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
  invalidateCache: () => Promise.resolve(),
}));

const managers = new Map<string, CallManager>([
  ['501', { userId: 'u1', extension: '101' }],
  ['502', { userId: 'u2', extension: null }],
]);

describe('noteToCallRow', () => {
  it('maps an outbound call to the manager extension and phone', () => {
    const row = noteToCallRow(
      {
        id: 9001,
        entity_id: 77,
        note_type: 'call_out',
        created_at: 1_762_500_000,
        responsible_user_id: 501,
        created_by: 0,
        params: { duration: '116', phone: '+998 90 123 45 67', uniq: 'abc-1', call_status: 4 },
      },
      'contacts',
      't1',
      managers,
    );

    expect(row).toMatchObject({
      tenantId: 't1',
      provider: 'amocrm',
      callIdExternal: 'uniq:abc-1',
      from: '101',
      to: '+998 90 123 45 67',
      direction: 'outbound',
      duration: 116,
      status: 'completed',
    });
    expect(row?.startedAt).toEqual(new Date(1_762_500_000 * 1000));
    expect(row?.metadata).toMatchObject({ normalized_extension: '101', manager_user_id: 'u1', amocrm_user_id: '501' });
  });

  it('maps an unanswered inbound call and falls back to the note id and author', () => {
    const row = noteToCallRow(
      { id: 12, note_type: 'call_in', created_at: 1_762_500_000, responsible_user_id: 0, created_by: 501, params: { phone: '998901112233' } },
      'leads',
      't1',
      managers,
    );

    expect(row).toMatchObject({
      callIdExternal: 'note:leads:12',
      from: '998901112233',
      to: '101',
      direction: 'inbound',
      duration: 0,
      status: 'missed',
    });
  });

  it('keeps calls of unmapped users without an extension and skips non-call notes', () => {
    const unmapped = noteToCallRow(
      { id: 1, note_type: 'call_out', created_at: 1_762_500_000, responsible_user_id: 999, params: { duration: 30 } },
      'contacts',
      't1',
      managers,
    );

    expect(unmapped).toMatchObject({ from: '', metadata: expect.objectContaining({ normalized_extension: null, manager_user_id: null }) });
    expect(noteToCallRow({ id: 2, note_type: 'common', created_at: 1_762_500_000 }, 'leads', 't1', managers)).toBeNull();
    expect(noteToCallRow({ id: 3, note_type: 'call_in' }, 'leads', 't1', managers)).toBeNull();
  });
});

describe('calls source settings', () => {
  it('reads sync cursors defensively', () => {
    expect(readCallsSyncState(null)).toEqual({ cursors: {}, lastRunAt: undefined, lastError: null, backfillComplete: false });
    expect(readCallsSyncState({ calls_sync: { cursors: { contacts: 100, leads: 'x' }, backfillComplete: true } })).toMatchObject({
      cursors: { contacts: 100 },
      backfillComplete: true,
    });
  });

  it('defaults to Utel unless amoCRM is chosen', () => {
    expect(readCallsSource(undefined)).toBe('utel');
    expect(readCallsSource({ calls_source: 'something' })).toBe('utel');
    expect(readCallsSource({ calls_source: 'amocrm' })).toBe('amocrm');
  });
});

describe('getCallsProviderFilter', () => {
  it('excludes amoCRM rows while Utel is the source', async () => {
    const { prisma } = jest.requireMock('@dashboarduz/db');

    prisma.integration = { findUnique: () => Promise.resolve({ status: 'active', config: {} }) };
    await expect(getCallsProviderFilter('t1')).resolves.toEqual({ not: 'amocrm' });
    prisma.integration = { findUnique: () => Promise.resolve({ status: 'active', config: { calls_source: 'amocrm' } }) };
    await expect(getCallsProviderFilter('t1')).resolves.toBe('amocrm');
    prisma.integration = { findUnique: () => Promise.resolve({ status: 'inactive', config: { calls_source: 'amocrm' } }) };
    await expect(getCallsProviderFilter('t1')).resolves.toEqual({ not: 'amocrm' });
  });
});
