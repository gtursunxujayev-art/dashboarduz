import { describe, expect, it } from '@jest/globals';

import { countedCallsWhere } from '../../calls-source';
import { noteToCallRow, readCallsSyncState, type CallManager } from '../amocrm-call-sync';

jest.mock('@dashboarduz/db', () => {
  const client = {};

  return { prisma: client, systemPrisma: client };
});

const managers = new Map<string, CallManager>([
  ['501', { userId: 'u1' }],
  ['502', { userId: 'u2' }],
]);

describe('noteToCallRow', () => {
  it('attributes an outbound call to the manager mapped to the responsible amoCRM user', () => {
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
      from: '',
      to: '+998 90 123 45 67',
      direction: 'outbound',
      duration: 116,
      status: 'completed',
      managerUserId: 'u1',
    });
    expect(row?.startedAt).toEqual(new Date(1_762_500_000 * 1000));
    expect(row?.metadata).toMatchObject({ manager_user_id: 'u1', amocrm_user_id: '501' });
    expect(row?.metadata).not.toHaveProperty('normalized_extension');
  });

  it('maps an unanswered inbound call and falls back to the note id and author', () => {
    const row = noteToCallRow(
      { id: 12, note_type: 'call_in', created_at: 1_762_500_000, responsible_user_id: 0, created_by: 502, params: { phone: '998901112233' } },
      'leads',
      't1',
      managers,
    );

    expect(row).toMatchObject({
      callIdExternal: 'note:leads:12',
      from: '998901112233',
      to: '',
      direction: 'inbound',
      duration: 0,
      status: 'missed',
      managerUserId: 'u2',
    });
  });

  it('keeps calls of unmapped amoCRM users without a manager and skips non-call notes', () => {
    const unmapped = noteToCallRow(
      { id: 1, note_type: 'call_out', created_at: 1_762_500_000, responsible_user_id: 999, params: { duration: 30 } },
      'contacts',
      't1',
      managers,
    );

    expect(unmapped).toMatchObject({ managerUserId: null, metadata: expect.objectContaining({ amocrm_user_id: '999', manager_user_id: null }) });
    expect(noteToCallRow({ id: 2, note_type: 'common', created_at: 1_762_500_000 }, 'leads', 't1', managers)).toBeNull();
    expect(noteToCallRow({ id: 3, note_type: 'call_in' }, 'leads', 't1', managers)).toBeNull();
  });
});

describe('calls sync state', () => {
  it('reads sync cursors defensively', () => {
    expect(readCallsSyncState(null)).toEqual({ cursors: {}, lastRunAt: undefined, lastError: null, backfillComplete: false });
    expect(readCallsSyncState({ calls_sync: { cursors: { contacts: 100, leads: 'x' }, backfillComplete: true } })).toMatchObject({
      cursors: { contacts: 100 },
      backfillComplete: true,
    });
  });
});

describe('countedCallsWhere', () => {
  it('counts amoCRM rows only, optionally limited to some managers', () => {
    expect(countedCallsWhere('t1')).toEqual({ tenantId: 't1', provider: 'amocrm' });
    expect(countedCallsWhere('t1', ['u1', 'u2'])).toEqual({ tenantId: 't1', provider: 'amocrm', managerUserId: { in: ['u1', 'u2'] } });
  });
});
