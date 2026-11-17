import type { AmoCRMTask } from '../../services/integrations/amocrm';
import {
  isCompletedTask,
  isLeadTask,
  parseAmoTimestamp,
  taskResponsibleUserId,
  toStringId,
} from '../amocrm';

const task = (fields: Record<string, unknown>) => fields as unknown as AmoCRMTask;

describe('parseAmoTimestamp (workers and the leads router)', () => {
  it('reads seconds, milliseconds, numeric strings and date strings alike', () => {
    expect(parseAmoTimestamp(1_700_000_000)?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(parseAmoTimestamp(1_700_000_000_000)?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(parseAmoTimestamp('1700000000')?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(parseAmoTimestamp('2024-05-01T10:00:00Z')?.toISOString()).toBe('2024-05-01T10:00:00.000Z');
  });

  it('is null for a missing, unparseable or out-of-range timestamp (leads used to show the current time)', () => {
    expect(parseAmoTimestamp('nope')).toBeNull();
    expect(parseAmoTimestamp(undefined)).toBeNull();
    expect(parseAmoTimestamp(1e20)).toBeNull();
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
