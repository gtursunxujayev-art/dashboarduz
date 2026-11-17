import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@dashboarduz/db', () => ({ systemPrisma: {} }));
jest.mock('../../queue/redis-client', () => ({ getRedisClient: () => ({}) }));

/* eslint-disable import/first -- the mocks above must be registered before these imports */
import { planWindows } from '../amocrm-activity-snapshot';
import { readActivityReadiness, taskQueryUsesSnapshot } from '../amocrm-activity-snapshot-read';
import { leadQueryUsesSnapshot } from '../amocrm-lead-snapshot-read';
import { isRangeInSnapshot, SNAPSHOT_WINDOW_DAYS, snapshotCutoff } from '../amocrm-snapshot-window';
/* eslint-enable import/first */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-17T12:00:00.000Z');
const inWindow = new Date(NOW.getTime() - 30 * DAY);
const beforeWindow = new Date(NOW.getTime() - 70 * DAY);

describe('snapshot window', () => {
  it('covers the last 62 days once the snapshot is ready', () => {
    expect(SNAPSHOT_WINDOW_DAYS).toBe(62);
    expect(snapshotCutoff(NOW)).toEqual(new Date(NOW.getTime() - 62 * DAY));
    expect(isRangeInSnapshot(inWindow, true, NOW)).toBe(true);
    expect(isRangeInSnapshot(beforeWindow, true, NOW)).toBe(false);
    expect(isRangeInSnapshot(inWindow, false, NOW)).toBe(false);
    expect(isRangeInSnapshot(undefined, true, NOW)).toBe(false);
  });

  it('starts the backfill at the window even when an older cursor is stored', () => {
    const windows = planWindows({ cursor: NOW.getTime() - 300 * DAY, backfillComplete: false }, NOW.getTime());

    expect(windows[0]?.from).toBe(NOW.getTime() - 62 * DAY);
  });
});

describe('lead queries', () => {
  it('read the snapshot inside the window and for current-stage queries, amoCRM otherwise', () => {
    expect(leadQueryUsesSnapshot({ createdAtFrom: inWindow }, true, NOW)).toBe(true);
    expect(leadQueryUsesSnapshot({ pipelineIds: ['7'] }, true, NOW)).toBe(true); // open leads of any age are stored
    expect(leadQueryUsesSnapshot({ createdAtFrom: beforeWindow }, true, NOW)).toBe(false);
    expect(leadQueryUsesSnapshot({ query: 'Ali' }, true, NOW)).toBe(false);
    expect(leadQueryUsesSnapshot({ createdAtFrom: inWindow }, false, NOW)).toBe(false);
  });
});

describe('task queries', () => {
  const ready = readActivityReadiness({ activity_snapshot: { tasks: { backfillComplete: true, openTasksLoaded: true }, events: { backfillComplete: true } } });

  it('reads readiness from the stored state', () => {
    expect(ready).toEqual({ tasks: true, openTasks: true, events: true });
    expect(readActivityReadiness(null)).toEqual({ tasks: false, openTasks: false, events: false });
  });

  it('serve open tasks of any age and finished tasks in the window from the snapshot', () => {
    expect(taskQueryUsesSnapshot({ completed: false, dateTo: NOW }, ready, NOW)).toBe(true);
    expect(taskQueryUsesSnapshot({ completed: true, dateFrom: inWindow }, ready, NOW)).toBe(true);
    expect(taskQueryUsesSnapshot({ completed: true, dateFrom: beforeWindow }, ready, NOW)).toBe(false);
    expect(taskQueryUsesSnapshot({ completed: false }, { tasks: false, openTasks: false, events: false }, NOW)).toBe(false);
  });
});
