import { describe, expect, it, jest } from '@jest/globals';

import { dedupeByAmoId, writeLeadsByAmoId } from '../amocrm-lead-store';

jest.mock('@dashboarduz/db', () => ({ systemPrisma: {} }));

function fakeDb(existingIds: string[]) {
  const calls: Array<[string, unknown]> = [];
  const lead = {
    findMany: jest.fn((args: unknown) => {
      calls.push(['findMany', args]);

      return Promise.resolve(existingIds.map((amocrmId) => ({ amocrmId })));
    }),
    updateMany: jest.fn((args: unknown) => {
      calls.push(['updateMany', args]);

      return Promise.resolve({ count: 1 });
    }),
    createMany: jest.fn((args: unknown) => {
      calls.push(['createMany', args]);

      return Promise.resolve({ count: 1 });
    }),
  };
  const db = { lead, $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({ lead }) };

  return { db: db as never, calls };
}

describe('writeLeadsByAmoId', () => {
  it('updates stored leads and inserts new ones without relying on a unique index', async () => {
    const { db, calls } = fakeDb(['1']);

    const result = await writeLeadsByAmoId('t1', [
      { amocrmId: '1', update: { title: 'Old lead' }, create: { title: 'Old lead' } },
      { amocrmId: '2', update: { title: 'New lead' }, create: { title: 'New lead' } },
      { amocrmId: '2', update: { title: 'New lead v2' }, create: { title: 'New lead v2' } },
    ], db);

    expect(result).toEqual({ created: 1, updated: 1 });
    expect(calls.map(([name]) => name)).toEqual(['findMany', 'updateMany', 'createMany']);
    expect(calls[1]?.[1]).toEqual({ where: { tenantId: 't1', amocrmId: '1' }, data: { title: 'Old lead' } });
    expect(calls[2]?.[1]).toEqual({ data: [{ title: 'New lead v2', tenantId: 't1', amocrmId: '2' }] });
  });

  it('does nothing for an empty page', async () => {
    const { db, calls } = fakeDb([]);

    await expect(writeLeadsByAmoId('t1', [], db)).resolves.toEqual({ created: 0, updated: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe('dedupeByAmoId', () => {
  it('keeps the most recently updated copy of a lead stored twice', () => {
    const older = { amocrmId: '1', externalUpdatedAt: new Date('2026-11-01'), tag: 'older' };
    const newer = { amocrmId: '1', externalUpdatedAt: new Date('2026-11-10'), tag: 'newer' };
    const other = { amocrmId: '2', externalUpdatedAt: null, tag: 'other' };

    expect(dedupeByAmoId([older, other, newer]).map((row) => row.tag)).toEqual(['newer', 'other']);
  });
});
