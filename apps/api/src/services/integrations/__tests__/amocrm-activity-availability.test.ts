import { amocrmService } from '../amocrm';
import {
  buildActivityCacheKey,
  createAmoCRMActivityDiagnostics,
  getAmoCRMActivityMetrics,
  getAmoCRMActivityMetricsWithin,
  resetAmoCRMActivityCache,
} from '../amocrm-activity';

type TaskParams = { completedOnly?: boolean };

const baseParams = {
  tenantId: 'availability-test',
  accessToken: 'token',
  managerIds: ['10'],
  rangeStart: new Date('2026-09-15T00:00:00.000Z'),
  rangeEnd: new Date('2026-09-15T23:59:59.999Z'),
};

describe('AmoCRM activity availability', () => {
  beforeEach(() => resetAmoCRMActivityCache());
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('preserves successful sources and marks only a failed source unavailable', async () => {
    // The three sources run in parallel, so fail by filter rather than by call order.
    jest.spyOn(amocrmService, 'fetchAllTasks').mockImplementation((_token, params) => (
      (params as TaskParams).completedOnly
        ? Promise.reject(new Error('completed task fetch failed'))
        : Promise.resolve([] as never)
    ));
    jest.spyOn(amocrmService, 'fetchAllEvents').mockResolvedValue([] as never);
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

  it('shares one set of amoCRM requests between concurrent callers and caches the result', async () => {
    const tasks = jest.spyOn(amocrmService, 'fetchAllTasks').mockResolvedValue([] as never);
    const events = jest.spyOn(amocrmService, 'fetchAllEvents').mockResolvedValue([] as never);

    await Promise.all([getAmoCRMActivityMetrics(baseParams), getAmoCRMActivityMetrics(baseParams)]);
    await getAmoCRMActivityMetrics(baseParams);

    expect(tasks).toHaveBeenCalledTimes(2); // completed + pending, once
    expect(events).toHaveBeenCalledTimes(1);
  });

  it('answers without waiting for slow amoCRM and serves the result once it lands', async () => {
    let releaseEvents: (value: never) => void = () => undefined;

    jest.spyOn(amocrmService, 'fetchAllTasks').mockResolvedValue([] as never);
    jest.spyOn(amocrmService, 'fetchAllEvents').mockImplementation(() => new Promise((resolve) => {
      releaseEvents = resolve as (value: never) => void;
    }));

    const first = await getAmoCRMActivityMetricsWithin(baseParams, 20);

    expect(first).toEqual({ metrics: null, pending: true, stale: false });

    releaseEvents([] as never);
    await new Promise((resolve) => setImmediate(resolve));

    const second = await getAmoCRMActivityMetricsWithin(baseParams, 20);

    expect(second.pending).toBe(false);
    expect(second.metrics?.get('10')).toMatchObject({ noteCount: 0 });
  });

  it('returns the expired result while refreshing it in the background', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    const events = jest.spyOn(amocrmService, 'fetchAllEvents').mockResolvedValue([] as never);

    jest.spyOn(amocrmService, 'fetchAllTasks').mockResolvedValue([] as never);
    await getAmoCRMActivityMetrics(baseParams);
    jest.advanceTimersByTime(2 * 60 * 1000);

    const lookup = await getAmoCRMActivityMetricsWithin(baseParams, 20);

    expect(lookup).toMatchObject({ pending: false, stale: true });
    expect(lookup.metrics?.has('10')).toBe(true);
    expect(events).toHaveBeenCalledTimes(2);
  });
});
