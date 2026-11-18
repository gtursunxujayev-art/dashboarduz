import {
  activityFailureReason,
  countCompletedFollowUps,
  countEventActivity,
  countOpenFollowUps,
  createEmptyMetrics,
  eventActorUserId,
  eventDate,
  hasText,
  isNoteEvent,
  isStageChangeEvent,
  isWithinRange,
  summarizeAmoCRMActivityMetrics,
  taskActionDate,
  toActivityDate,
  type ActivityMetricsByManager,
} from '../amocrm-activity-count';
import {
  getPeriodFollowUpBounds,
  getTashkentDayBounds,
  getTashkentMonthBounds,
  getTashkentWeekBounds,
} from '../amocrm-activity-periods';

const iso = (date: Date | null) => date?.toISOString() ?? null;

describe('toActivityDate', () => {
  it('reads seconds, milliseconds, numeric and date strings', () => {
    expect(iso(toActivityDate(1767225600))).toBe('2026-01-01T00:00:00.000Z');
    expect(iso(toActivityDate(1767225600123))).toBe('2026-01-01T00:00:00.123Z');
    expect(iso(toActivityDate('1767225600'))).toBe('2026-01-01T00:00:00.000Z');
    expect(iso(toActivityDate('2026-01-01T05:00:00Z'))).toBe('2026-01-01T05:00:00.000Z');
    expect(iso(toActivityDate(''))).toBe('1970-01-01T00:00:00.000Z');
  });

  it('reads Date values and the first valid timestamp field of an object', () => {
    const date = new Date('2026-02-02T00:00:00Z');

    expect(toActivityDate(date)).toBe(date);
    expect(toActivityDate(new Date('nope'))).toBeNull();
    expect(iso(toActivityDate({ ts: 'bad', value: 1767225600, date: 1 }))).toBe('2026-01-01T00:00:00.000Z');
    expect(iso(toActivityDate({ timestamp: { datetime: '2026-03-03T00:00:00Z' } }))).toBe('2026-03-03T00:00:00.000Z');
  });

  it('gives null for anything else', () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 'not a date', true, [1767225600], {}]) {
      expect(toActivityDate(value)).toBeNull();
    }
  });
});

describe('task and event readers', () => {
  it('checks ranges inclusively and treats a missing date as outside', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-01-02T00:00:00Z');

    expect(isWithinRange(start, start, end)).toBe(true);
    expect(isWithinRange(end, start, end)).toBe(true);
    expect(isWithinRange(new Date(end.getTime() + 1), start, end)).toBe(false);
    expect(isWithinRange(null, start, end)).toBe(false);
  });

  it('dates a task by due time, else update, else creation', () => {
    expect(iso(taskActionDate({ complete_till: 1767225600, updated_at: 1767312000 }))).toBe('2026-01-01T00:00:00.000Z');
    expect(iso(taskActionDate({ updated_at: 1767312000, created_at: 1767398400 }))).toBe('2026-01-02T00:00:00.000Z');
    expect(iso(taskActionDate({ created_at: 1767398400 }))).toBe('2026-01-03T00:00:00.000Z');
    expect(taskActionDate({})).toBeNull();
  });

  it('reads the event author and date from their alternative fields', () => {
    expect(eventActorUserId({ created_by: 0, user_id: ' 7 ', responsible_user_id: 9 })).toBe('7');
    expect(eventActorUserId({ responsible_user_id: 9 })).toBe('9');
    expect(eventActorUserId({})).toBe('');
    expect(iso(eventDate({ createdAt: '2026-01-01T00:00:00Z' }))).toBe('2026-01-01T00:00:00.000Z');
    expect(iso(eventDate({ date_create: { timestamp: 1767225600 } }))).toBe('2026-01-01T00:00:00.000Z');
  });

  it('finds text anywhere in strings, arrays and object values (not keys)', () => {
    expect(hasText('A NOTE here', 'note')).toBe(true);
    expect(hasText([1, ['x', { deep: 'Notes' }]], 'note')).toBe(true);
    expect(hasText({ note: 1 }, 'note')).toBe(false);
    expect(hasText(42, 'note')).toBe(false);
    expect(hasText(null, 'note')).toBe(false);
  });
});

describe('event classification', () => {
  it('spots note events by type or by any text', () => {
    expect(isNoteEvent({ type: 'common_note_added' })).toBe(true);
    expect(isNoteEvent({ event_type: 'x', value_after: [{ text: 'Call note' }] })).toBe(true);
    expect(isNoteEvent({ type: 'lead_status_changed' })).toBe(false);
  });

  it('spots stage changes by type, by a status / pipeline field, or by a before / after value mentioning one', () => {
    expect(isStageChangeEvent({ type: 'lead_status_changed' })).toBe(true);
    expect(isStageChangeEvent({ name: 'Pipeline moved' })).toBe(true);
    expect(isStageChangeEvent({ type: 'x', pipeline_after: 5 })).toBe(true);
    expect(isStageChangeEvent({ type: 'x', status_before: ' ', value_after: { lead_status: { id: 3 } } })).toBe(false);
    expect(isStageChangeEvent({ type: 'x', value_before: 'old stage' })).toBe(true);
    expect(isStageChangeEvent({ type: 'x', value_after: { foo: 'bar' }, status_after: 'won' })).toBe(true);
    expect(isStageChangeEvent({ type: 'x', status_id: null })).toBe(false);
  });
});

describe('counting', () => {
  const range = { start: new Date('2026-09-14T19:00:00Z'), end: new Date('2026-09-15T18:59:59.999Z') };
  const seconds = (value: string) => Date.parse(value) / 1000;

  function managers(...ids: string[]): ActivityMetricsByManager {
    return new Map(ids.map((id) => [id, createEmptyMetrics()]));
  }

  it('counts completed lead tasks of known managers within the range', () => {
    const metrics = managers('1', '2');

    countCompletedFollowUps(metrics, [
      { responsible_user_id: 1, is_completed: true, complete_till: seconds('2026-09-15T00:00:00Z') },
      { responsible_user_id: 1, is_completed: true, entity_type: 'contacts', complete_till: seconds('2026-09-15T00:00:00Z') },
      { responsible_user_id: 1, is_completed: false, complete_till: seconds('2026-09-15T00:00:00Z') },
      { responsible_user_id: 2, is_completed: true, complete_till: seconds('2026-09-01T00:00:00Z') },
      { responsible_user_id: 3, is_completed: true, complete_till: seconds('2026-09-15T00:00:00Z') },
    ], range);

    expect([metrics.get('1')?.followUpCount, metrics.get('2')?.followUpCount, metrics.has('3')]).toEqual([1, 0, false]);
  });

  it('counts open tasks as overdue before today, due within the period, and ignores the rest', () => {
    const metrics = managers('1');

    countOpenFollowUps(metrics, [
      { responsible_user_id: 1, is_completed: false, complete_till: seconds('2026-09-14T18:59:59Z') },
      { responsible_user_id: 1, is_completed: false, complete_till: seconds('2026-09-14T19:00:00Z') },
      { responsible_user_id: 1, is_completed: false, complete_till: seconds('2026-09-16T00:00:00Z') },
      { responsible_user_id: 1, is_completed: false },
      { responsible_user_id: 1, is_completed: true, complete_till: seconds('2026-09-01T00:00:00Z') },
    ], range.start, range);

    expect(metrics.get('1')).toEqual({ ...createEmptyMetrics(), overdueFollowUpCount: 1, todayFollowUpCount: 1 });
  });

  it('counts an event as a note before a stage change, within the range only', () => {
    const metrics = managers('1');

    countEventActivity(metrics, [
      { created_by: 1, type: 'note_status', created_at: seconds('2026-09-15T00:00:00Z') },
      { created_by: 1, type: 'lead_status_changed', created_at: seconds('2026-09-15T00:00:00Z') },
      { created_by: 1, type: 'lead_status_changed', created_at: seconds('2026-09-16T00:00:00Z') },
      { created_by: 2, type: 'common_note_added', created_at: seconds('2026-09-15T00:00:00Z') },
    ], range);

    expect(metrics.get('1')).toEqual({ ...createEmptyMetrics(), noteCount: 1, stageChangeCount: 1 });
  });

  it('sums all managers', () => {
    const metrics: ActivityMetricsByManager = new Map([
      ['1', { followUpCount: 1, noteCount: 2, stageChangeCount: 3, overdueFollowUpCount: 4, todayFollowUpCount: 5 }],
      ['2', { followUpCount: 10, noteCount: 20, stageChangeCount: 30, overdueFollowUpCount: 40, todayFollowUpCount: 50 }],
    ]);

    expect(summarizeAmoCRMActivityMetrics(metrics)).toEqual({
      followUpCount: 11, noteCount: 22, stageChangeCount: 33, overdueFollowUpCount: 44, todayFollowUpCount: 55,
    });
    expect(summarizeAmoCRMActivityMetrics(new Map())).toEqual(createEmptyMetrics());
  });
});

describe('activityFailureReason', () => {
  it('classifies timeouts, our HTTP errors and network errors', () => {
    expect(activityFailureReason(new Error('AmoCRM request TIMEOUT after 10ms'))).toBe('timeout');
    expect(activityFailureReason(new Error('Failed to fetch AmoCRM events: 502 Bad Gateway'))).toBe('fetch_failed');
    expect(activityFailureReason(new Error('Failed to fetch AmoCRM tasks: network down'))).toBe('fetch_failed');
    expect(activityFailureReason(new TypeError('fetch failed'))).toBe('network_error');
    expect(activityFailureReason('Network unreachable')).toBe('network_error');
    expect(activityFailureReason(new Error(''))).toBe('fetch_failed');
    expect(activityFailureReason(undefined)).toBe('fetch_failed');
  });
});

describe('Tashkent periods', () => {
  // 2026-09-15 is a Tuesday; 23:30 UTC is already Wednesday 04:30 in Tashkent (UTC+5).
  const lateTuesdayUtc = new Date('2026-09-15T23:30:00Z');

  it('gives the Tashkent day, Monday-based week and month around an instant', () => {
    expect(getTashkentDayBounds(lateTuesdayUtc)).toEqual({
      start: new Date('2026-09-15T19:00:00.000Z'),
      end: new Date('2026-09-16T18:59:59.999Z'),
    });
    expect(getTashkentWeekBounds(lateTuesdayUtc)).toEqual({
      start: new Date('2026-09-13T19:00:00.000Z'),
      end: new Date('2026-09-20T18:59:59.999Z'),
    });
    expect(getTashkentWeekBounds(new Date('2026-09-20T12:00:00Z'))).toEqual({
      start: new Date('2026-09-13T19:00:00.000Z'),
      end: new Date('2026-09-20T18:59:59.999Z'),
    });
    expect(getTashkentMonthBounds(new Date('2026-12-31T20:00:00Z'))).toEqual({
      start: new Date('2026-12-31T19:00:00.000Z'),
      end: new Date('2027-01-31T18:59:59.999Z'),
    });
  });

  it('picks the follow-up period by range kind', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-01-05T00:00:00Z');

    expect(getPeriodFollowUpBounds('custom', start, end, lateTuesdayUtc)).toEqual({ start, end });
    expect(getPeriodFollowUpBounds('week', start, end, lateTuesdayUtc)).toEqual(getTashkentWeekBounds(lateTuesdayUtc));
    expect(getPeriodFollowUpBounds('month', start, end, lateTuesdayUtc)).toEqual(getTashkentMonthBounds(lateTuesdayUtc));
    expect(getPeriodFollowUpBounds('today', start, end, lateTuesdayUtc)).toEqual(getTashkentDayBounds(lateTuesdayUtc));
    expect(getPeriodFollowUpBounds(undefined, start, end, lateTuesdayUtc)).toEqual(getTashkentDayBounds(lateTuesdayUtc));
  });
});
