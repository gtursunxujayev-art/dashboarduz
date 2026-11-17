import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@dashboarduz/db', () => ({ systemPrisma: {} }));
jest.mock('../../queue/redis-client', () => ({ getRedisClient: () => ({}) }));

/* eslint-disable import/first -- the mocks above must be registered before these imports */
import { BACKFILL_DAYS, eventToRow, planWindows, readActivitySnapshotState, taskToRow, withPageRetry } from '../amocrm-activity-snapshot';
import { buildSnapshotEventWhere, buildSnapshotTaskWhere } from '../amocrm-activity-snapshot-read';
/* eslint-enable import/first */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-17T12:00:00.000Z');

describe('activity snapshot windows', () => {
  it('backfills a new tenant in week windows ending now', () => {
    const windows = planWindows({ cursor: null, backfillComplete: false }, NOW);

    expect(windows[0]?.from).toBe(NOW - BACKFILL_DAYS * DAY);
    expect(windows.at(-1)?.to).toBe(NOW);
    expect(windows.every((window) => window.to - window.from <= 7 * DAY)).toBe(true);
    // Contiguous: no gap between windows.
    for (let index = 1; index < windows.length; index += 1) {
      expect(windows[index]?.from).toBe(windows[index - 1]?.to);
    }
  });

  it('resumes just before the cursor once caught up', () => {
    const windows = planWindows({ cursor: NOW - 5 * 60_000, backfillComplete: true }, NOW);

    expect(windows).toEqual([{ from: NOW - 7 * 60_000, to: NOW }]);
  });

  it('reads stored progress defensively', () => {
    expect(readActivitySnapshotState(null)).toEqual({
      tasks: { cursor: null, backfillComplete: false },
      events: { cursor: null, backfillComplete: false },
      referenceRefreshedAt: null,
      lastRunAt: null,
      lastError: null,
    });
    expect(readActivitySnapshotState({ activity_snapshot: { events: { cursor: 5, backfillComplete: true } } }).events)
      .toEqual({ cursor: 5, backfillComplete: true });
  });
});

describe('activity snapshot rows', () => {
  it('maps a task to indexed columns and keeps the payload', () => {
    const task = { id: 42, responsible_user_id: 7, entity_type: 'leads', entity_id: 9, is_completed: 1, complete_till: 1_763_380_800, updated_at: 1_763_384_400 };

    expect(taskToRow('t1', task)).toMatchObject({
      tenantId: 't1',
      amocrmId: '42',
      responsibleUserId: '7',
      entityType: 'leads',
      entityId: '9',
      isCompleted: true,
      completeTill: new Date(1_763_380_800 * 1000),
      payload: task,
    });
    expect(taskToRow('t1', { responsible_user_id: 7 })).toBeNull();
  });

  it('maps an event and skips one without a date', () => {
    expect(eventToRow('t1', { id: 'abc', type: 'lead_status_changed', entity_type: 'lead', entity_id: 5, created_by: 0, created_at: 1_763_380_800 }))
      .toMatchObject({ amocrmId: 'abc', type: 'lead_status_changed', entityId: '5', createdBy: null, externalCreatedAt: new Date(1_763_380_800 * 1000) });
    expect(eventToRow('t1', { id: 'abc' })).toBeNull();
  });
});

describe('snapshot reader filters', () => {
  it('mirrors the amoCRM task filters', () => {
    const from = new Date('2026-11-01');
    const to = new Date('2026-11-30');

    expect(buildSnapshotTaskWhere('t1', { responsibleUserIds: [' 7 ', ''], completed: false, dateFrom: from, dateTo: to, entityType: 'leads' })).toEqual({
      tenantId: 't1',
      responsibleUserId: { in: ['7'] },
      isCompleted: false,
      completeTill: { gte: from, lte: to },
      entityType: { in: ['lead', 'leads'] },
    });
    expect(buildSnapshotTaskWhere('t1', {})).toEqual({ tenantId: 't1' });
  });

  it('mirrors the amoCRM event filters', () => {
    const from = new Date('2026-11-01');

    expect(buildSnapshotEventWhere('t1', { userIds: ['7'], dateFrom: from, entityType: 'lead' })).toEqual({
      tenantId: 't1',
      createdBy: { in: ['7'] },
      externalCreatedAt: { gte: from },
      entityType: { in: ['lead', 'leads'] },
    });
  });
});

describe('page retry', () => {
  const noWait = () => Promise.resolve();

  it('retries timeouts and dropped connections, then succeeds', async () => {
    const load = jest.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('AmoCRM request timeout after 45000ms'))
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce('page');

    await expect(withPageRetry(load, noWait)).resolves.toBe('page');
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not retry other errors and gives up after three attempts', async () => {
    const bad = jest.fn<() => Promise<string>>().mockRejectedValue(new Error('Failed to fetch AmoCRM events: 400 Bad Request'));
    const slow = jest.fn<() => Promise<string>>().mockRejectedValue(new Error('AmoCRM request timeout after 45000ms'));

    await expect(withPageRetry(bad, noWait)).rejects.toThrow('400');
    expect(bad).toHaveBeenCalledTimes(1);
    await expect(withPageRetry(slow, noWait)).rejects.toThrow('timeout');
    expect(slow).toHaveBeenCalledTimes(3);
  });
});
