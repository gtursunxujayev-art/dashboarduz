import { systemPrisma } from '@dashboarduz/db';

import type { AmoCRMEvent, AmoCRMTask } from '../amocrm';
import {
  createAmoCRMActivityDiagnostics,
  getAmoCRMActivityMetrics,
  resetAmoCRMActivityCache,
  summarizeAmoCRMActivityMetrics,
} from '../amocrm-activity';
import * as snapshotRead from '../amocrm-activity-snapshot-read';

const NOW = new Date('2026-09-15T12:00:00.000Z'); // Tuesday 17:00 in Tashkent
const seconds = (iso: string) => Date.parse(iso) / 1000;

const completedTasks: AmoCRMTask[] = [
  { id: 1, responsible_user_id: 10, entity_type: 'leads', is_completed: true, complete_till: seconds('2026-09-15T05:00:00Z') },
  { id: 2, responsible_user_id: '10', is_completed: 1, updated_at: Date.parse('2026-09-15T06:00:00Z') },
  { id: 3, responsible_user_id: 10, is_completed: true, complete_till: seconds('2026-09-10T05:00:00Z') },
  { id: 4, responsible_user_id: 20, entity_type: 'contacts', is_completed: true, complete_till: seconds('2026-09-15T05:00:00Z') },
  { id: 5, responsible_user_id: 99, is_completed: true, complete_till: seconds('2026-09-15T05:00:00Z') },
  { id: 6, responsible_user_id: 30, is_completed: false, complete_till: seconds('2026-09-15T05:00:00Z') },
  { id: 7, responsible_user_id: 30, is_completed: true, complete_till: '2026-09-15T07:30:00.000Z' },
];

const pendingTasks: AmoCRMTask[] = [
  { id: 11, responsible_user_id: 10, is_completed: false, complete_till: seconds('2026-09-14T10:00:00Z') },
  { id: 12, responsible_user_id: 10, is_completed: false, complete_till: seconds('2026-09-15T15:00:00Z') },
  { id: 13, responsible_user_id: 20, is_completed: false, complete_till: seconds('2026-09-16T10:00:00Z') },
  { id: 14, responsible_user_id: 20, is_completed: true, complete_till: seconds('2026-09-14T10:00:00Z') },
  { id: 15, responsible_user_id: 20, is_completed: false },
  { id: 16, responsible_user_id: 30, is_completed: false, complete_till: seconds('2026-09-30T10:00:00Z') },
];

const events: AmoCRMEvent[] = [
  { id: 'e1', type: 'common_note_added', created_by: 10, created_at: seconds('2026-09-15T08:00:00Z') },
  { id: 'e2', type: 'lead_status_changed', user_id: 10, createdAt: Date.parse('2026-09-15T08:10:00Z') },
  { id: 'e3', type: 'custom', created_by: 20, created_at: seconds('2026-09-15T08:20:00Z'), value_after: { note: { text: 'Some NOTE' } } },
  { id: 'e4', type: 'entity_linked', created_by: 20, created_at: seconds('2026-09-15T08:30:00Z'), value_after: ['moved to pipeline'] },
  { id: 'e5', type: 'x', created_by: 20, created_at: seconds('2026-09-15T08:40:00Z'), status_id: 142 },
  { id: 'e6', type: 'x', created_by: 20, created_at: seconds('2026-09-15T08:50:00Z'), value_after: { foo: 'bar' } },
  { id: 'e7', type: 'common_note_added', created_by: 30, created_at: seconds('2026-09-01T08:00:00Z') },
  { id: 'e8', type: 'pipeline_changed', created_by: 10, date_create: { timestamp: seconds('2026-09-15T09:00:00Z') } },
  { id: 'e9', type: 'x', created_by: 30, created_at: seconds('2026-09-15T09:10:00Z'), status_before: '  ' },
  { id: 'e10', name: 'Stage moved', responsible_user_id: '30', created_at: '2026-09-15T09:20:00.000Z' },
];

const baseParams = {
  tenantId: 'activity-metrics-test',
  db: systemPrisma,
  accessToken: 'token',
  managerIds: ['10', '20', ' 30 ', ''],
  rangeStart: new Date('2026-09-14T19:00:00.000Z'),
  rangeEnd: new Date('2026-09-15T18:59:59.999Z'),
};

function mockSnapshot(): void {
  jest.spyOn(snapshotRead, 'getAmoTasks').mockImplementation((_tenantId, query) => Promise.resolve(
    query.completed ? completedTasks : pendingTasks,
  ));
  jest.spyOn(snapshotRead, 'getAmoEvents').mockResolvedValue(events);
}

describe('getAmoCRMActivityMetrics counting', () => {
  beforeEach(() => {
    resetAmoCRMActivityCache();
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('counts follow-ups, notes, stage changes and due tasks per manager for today', async () => {
    mockSnapshot();

    const result = await getAmoCRMActivityMetrics({ ...baseParams, rangeKind: 'today' });

    expect(Array.from(result.entries())).toEqual([
      ['10', { followUpCount: 2, noteCount: 1, stageChangeCount: 2, overdueFollowUpCount: 1, todayFollowUpCount: 1 }],
      ['20', { followUpCount: 0, noteCount: 1, stageChangeCount: 2, overdueFollowUpCount: 0, todayFollowUpCount: 0 }],
      ['30', { followUpCount: 1, noteCount: 0, stageChangeCount: 1, overdueFollowUpCount: 0, todayFollowUpCount: 0 }],
    ]);
    expect(summarizeAmoCRMActivityMetrics(result)).toEqual({
      followUpCount: 3,
      noteCount: 2,
      stageChangeCount: 5,
      overdueFollowUpCount: 1,
      todayFollowUpCount: 1,
    });
  });

  it('counts tasks due this week or this month for those range kinds', async () => {
    mockSnapshot();

    const week = await getAmoCRMActivityMetrics({ ...baseParams, rangeKind: 'week' });

    expect([week.get('10')?.todayFollowUpCount, week.get('20')?.todayFollowUpCount, week.get('30')?.todayFollowUpCount])
      .toEqual([1, 1, 0]);

    resetAmoCRMActivityCache();
    const month = await getAmoCRMActivityMetrics({ ...baseParams, rangeKind: 'month' });

    expect([month.get('10')?.todayFollowUpCount, month.get('20')?.todayFollowUpCount, month.get('30')?.todayFollowUpCount])
      .toEqual([1, 1, 1]);

    resetAmoCRMActivityCache();
    const custom = await getAmoCRMActivityMetrics({
      ...baseParams,
      rangeKind: 'custom',
      rangeStart: new Date('2026-09-16T00:00:00.000Z'),
      rangeEnd: new Date('2026-09-16T23:59:59.999Z'),
    });

    expect([custom.get('10')?.todayFollowUpCount, custom.get('20')?.todayFollowUpCount]).toEqual([0, 1]);
  });

  it('names the failure reason of each source', async () => {
    jest.spyOn(snapshotRead, 'getAmoTasks').mockImplementation((_tenantId, query) => Promise.reject(
      query.completed ? new Error('AmoCRM request timeout after 5ms') : new Error('Network unreachable'),
    ));
    jest.spyOn(snapshotRead, 'getAmoEvents').mockRejectedValue('boom');
    const diagnostics = createAmoCRMActivityDiagnostics();

    const result = await getAmoCRMActivityMetrics({ ...baseParams, diagnostics });

    expect(diagnostics).toEqual({
      completedTasks: { ok: false, reason: 'timeout' },
      pendingTasks: { ok: false, reason: 'network_error' },
      events: { ok: false, reason: 'fetch_failed' },
    });
    expect(result.get('10')).toEqual({
      followUpCount: 0, noteCount: 0, stageChangeCount: 0, overdueFollowUpCount: 0, todayFollowUpCount: 0,
    });
  });

  it('returns an empty map without reading anything when no manager id is left', async () => {
    const tasks = jest.spyOn(snapshotRead, 'getAmoTasks').mockResolvedValue([]);

    expect((await getAmoCRMActivityMetrics({ ...baseParams, managerIds: [' ', ''] })).size).toBe(0);
    expect(tasks).not.toHaveBeenCalled();
  });

  it('hands out copies, so callers cannot change the cached counts', async () => {
    mockSnapshot();

    const first = await getAmoCRMActivityMetrics({ ...baseParams, rangeKind: 'today' });
    const firstTen = first.get('10');

    if (firstTen) firstTen.noteCount = 99;
    const second = await getAmoCRMActivityMetrics({ ...baseParams, rangeKind: 'today' });

    expect(second.get('10')?.noteCount).toBe(1);
  });
});
