import { systemPrisma } from '@dashboarduz/db';

import {
  buildActivityCacheKey,
  createAmoCRMActivityDiagnostics,
  getAmoCRMActivityMetrics,
  getAmoCRMActivityMetricsWithin,
  resetAmoCRMActivityCache,
} from '../amocrm-activity';
import * as snapshotRead from '../amocrm-activity-snapshot-read';

const baseParams = {
  tenantId: 'availability-test',
  db: systemPrisma,
  accessToken: 'token',
  managerIds: ['10'],
  rangeStart: new Date('2026-09-15T00:00:00.000Z'),
  rangeEnd: new Date('2026-09-15T23:59:59.999Z'),
};

describe('AmoCRM activity (from the snapshot)', () => {
  beforeEach(() => resetAmoCRMActivityCache());
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('counts tasks and events read from the snapshot', async () => {
    const tasks = jest.spyOn(snapshotRead, 'fetchSnapshotTasks').mockImplementation((_tenantId, query) => Promise.resolve(
      query.completed
        ? [{ id: 1, responsible_user_id: '10', entity_type: 'leads', is_completed: true, complete_till: Date.parse('2026-09-15T08:00:00Z') / 1000 }]
        : [],
    ));
    const events = jest.spyOn(snapshotRead, 'fetchSnapshotEvents').mockResolvedValue([
      { id: 'e1', type: 'common_note_added', created_by: 10, created_at: Date.parse('2026-09-15T09:00:00Z') / 1000 },
      { id: 'e2', type: 'lead_status_changed', created_by: 10, created_at: Date.parse('2026-09-15T10:00:00Z') / 1000 },
    ]);

    const result = await getAmoCRMActivityMetrics(baseParams);

    expect(result.get('10')).toMatchObject({ followUpCount: 1, noteCount: 1, stageChangeCount: 1 });
    expect(tasks).toHaveBeenCalledWith('availability-test', expect.objectContaining({ responsibleUserIds: ['10'], entityType: 'leads' }), systemPrisma);
    expect(events).toHaveBeenCalledWith('availability-test', expect.objectContaining({ userIds: ['10'], entityType: 'lead' }), systemPrisma);
  });

  it('preserves successful sources and marks only a failed source unavailable', async () => {
    jest.spyOn(snapshotRead, 'fetchSnapshotTasks').mockImplementation((_tenantId, query) => (
      query.completed ? Promise.reject(new Error('completed task read failed')) : Promise.resolve([])
    ));
    jest.spyOn(snapshotRead, 'fetchSnapshotEvents').mockResolvedValue([]);
    const diagnostics = createAmoCRMActivityDiagnostics();

    const result = await getAmoCRMActivityMetrics({ ...baseParams, diagnostics });

    expect(result.get('10')).toEqual({
      followUpCount: 0,
      noteCount: 0,
      stageChangeCount: 0,
      overdueFollowUpCount: 0,
      todayFollowUpCount: 0,
    });
    expect(diagnostics.completedTasks.ok).toBe(false);
    expect(diagnostics.pendingTasks.ok).toBe(true);
    expect(diagnostics.events.ok).toBe(true);
  });

  it('keys open-ended ranges by start, not by the moving "now" end', () => {
    const now = Date.parse('2026-11-17T10:16:00.000Z');
    const start = new Date('2026-11-16T19:00:00.000Z');

    expect(buildActivityCacheKey('t', ['2', '1'], start, new Date(now - 1), now))
      .toBe(buildActivityCacheKey('t', ['1', '2'], start, new Date(now - 60_000), now));
    expect(buildActivityCacheKey('t', ['1'], start, new Date('2026-11-01T00:00:00.000Z'), now))
      .not.toBe(buildActivityCacheKey('t', ['1'], start, new Date(now), now));
  });

  it('shares one read between concurrent callers and caches the result', async () => {
    const tasks = jest.spyOn(snapshotRead, 'fetchSnapshotTasks').mockResolvedValue([]);
    const events = jest.spyOn(snapshotRead, 'fetchSnapshotEvents').mockResolvedValue([]);

    await Promise.all([getAmoCRMActivityMetrics(baseParams), getAmoCRMActivityMetrics(baseParams)]);
    await getAmoCRMActivityMetrics(baseParams);

    expect(tasks).toHaveBeenCalledTimes(2); // completed + open, once
    expect(events).toHaveBeenCalledTimes(1);
  });

  it('answers without waiting for a slow read and serves the result once it lands', async () => {
    let releaseEvents: (value: never[]) => void = () => undefined;

    jest.spyOn(snapshotRead, 'fetchSnapshotTasks').mockResolvedValue([]);
    jest.spyOn(snapshotRead, 'fetchSnapshotEvents').mockImplementation(() => new Promise((resolve) => {
      releaseEvents = resolve as (value: never[]) => void;
    }));

    const first = await getAmoCRMActivityMetricsWithin(baseParams, 20);

    expect(first).toEqual({ metrics: null, pending: true, stale: false });

    releaseEvents([]);
    await new Promise((resolve) => setImmediate(resolve));

    const second = await getAmoCRMActivityMetricsWithin(baseParams, 20);

    expect(second.pending).toBe(false);
    expect(second.metrics?.get('10')).toMatchObject({ noteCount: 0 });
  });

  it('returns the expired result while refreshing it in the background', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    const events = jest.spyOn(snapshotRead, 'fetchSnapshotEvents').mockResolvedValue([]);

    jest.spyOn(snapshotRead, 'fetchSnapshotTasks').mockResolvedValue([]);
    await getAmoCRMActivityMetrics(baseParams);
    jest.advanceTimersByTime(2 * 60 * 1000);

    const lookup = await getAmoCRMActivityMetricsWithin(baseParams, 20);

    expect(lookup).toMatchObject({ pending: false, stale: true });
    expect(lookup.metrics?.has('10')).toBe(true);
    expect(events).toHaveBeenCalledTimes(2);
  });
});
