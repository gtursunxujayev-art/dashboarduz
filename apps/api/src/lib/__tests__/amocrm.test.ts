import type { AmoCRMTask } from '../../services/integrations/amocrm';
import {
  isCompletedTask,
  isLeadTask,
  parseAmoTimestamp,
  parseAmoTimestampOrNow,
  taskResponsibleUserId,
  toStringId,
} from '../amocrm';

const task = (fields: Record<string, unknown>) => fields as unknown as AmoCRMTask;

describe('parseAmoTimestamp (workers) / parseAmoTimestampOrNow (leads router)', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z')));
  afterAll(() => jest.useRealTimers());

  it('reads seconds, milliseconds, numeric strings and date strings alike', () => {
    for (const parse of [parseAmoTimestamp, parseAmoTimestampOrNow]) {
      expect(parse(1_700_000_000)?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
      expect(parse(1_700_000_000_000)?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
      expect(parse('1700000000')?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
      expect(parse('2024-05-01T10:00:00Z')?.toISOString()).toBe('2024-05-01T10:00:00.000Z');
    }
  });

  it('differs on bad input: null vs now (and Invalid Date for out-of-range numbers)', () => {
    expect(parseAmoTimestamp('nope')).toBeNull();
    expect(parseAmoTimestamp(undefined)).toBeNull();
    expect(parseAmoTimestamp(1e20)).toBeNull();
    expect(parseAmoTimestampOrNow('nope').toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(parseAmoTimestampOrNow(undefined).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(Number.isNaN(parseAmoTimestampOrNow(1e20).getTime())).toBe(true);
  });
});

describe('amoCRM task readers', () => {
  it('toStringId keeps 0', () => {
    expect(toStringId(0)).toBe('0');
    expect(toStringId(null)).toBe('');
    expect(toStringId(' 7 ')).toBe('7');
  });

  it('isCompletedTask', () => {
    expect(isCompletedTask(task({ is_completed: true }))).toBe(true);
    expect(isCompletedTask(task({ completed: 1 }))).toBe(true);
    expect(isCompletedTask(task({ isCompleted: ' Done ' }))).toBe(true);
    expect(isCompletedTask(task({ is_completed: 'no' }))).toBe(false);
    expect(isCompletedTask(task({}))).toBe(false);
  });

  it('isLeadTask (the scheduler copy treated entity_type 0 as missing; the merged one does not)', () => {
    expect(isLeadTask(task({}))).toBe(true);
    expect(isLeadTask(task({ entity_type: 'Leads' }))).toBe(true);
    expect(isLeadTask(task({ entity_type: 'contacts' }))).toBe(false);
    expect(isLeadTask(task({ entity_type: 0 }))).toBe(false);
  });

  it('taskResponsibleUserId falls back through nested shapes', () => {
    expect(taskResponsibleUserId(task({ responsible_user_id: 5 }))).toBe('5');
    expect(taskResponsibleUserId(task({ responsible_user: { user_id: 6 } }))).toBe('6');
    expect(taskResponsibleUserId(task({ _embedded: { responsible_user: { id: 7 } } }))).toBe('7');
    expect(taskResponsibleUserId(task({}))).toBe('');
  });
});
