/**
 * Counting amoCRM activity per manager: completed follow-up tasks, overdue / due open tasks, note and
 * stage-change events. Pure functions over task and event payloads.
 */
import { isCompletedTask, isLeadTask, parseAmoTimestamp, taskResponsibleUserId, toStringId } from '../../lib/amocrm';
import { asObject } from '../../lib/object';

import type { AmoCRMEvent, AmoCRMTask } from './amocrm';
import type { ActivityPeriod } from './amocrm-activity-periods';

export type AmoCRMActivityMetrics = {
  followUpCount: number;
  noteCount: number;
  stageChangeCount: number;
  overdueFollowUpCount: number;
  todayFollowUpCount: number;
};

/** Counters per amoCRM manager id. Only managers present in the map are counted. */
export type ActivityMetricsByManager = Map<string, AmoCRMActivityMetrics>;

export function createEmptyMetrics(): AmoCRMActivityMetrics {
  return {
    followUpCount: 0,
    noteCount: 0,
    stageChangeCount: 0,
    overdueFollowUpCount: 0,
    todayFollowUpCount: 0,
  };
}

/**
 * A date out of an amoCRM value: Unix seconds or milliseconds, numeric or date strings, `Date`s, and objects
 * carrying one of those in `timestamp`, `ts`, `value`, `datetime` or `date` (first valid wins).
 */
export function toActivityDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const record = asObject(value);

  if (record) {
    return (
      toActivityDate(record.timestamp)
      || toActivityDate(record.ts)
      || toActivityDate(record.value)
      || toActivityDate(record.datetime)
      || toActivityDate(record.date)
      || null
    );
  }

  return parseAmoTimestamp(value);
}

export function isWithinRange(value: Date | null, start: Date, end: Date): boolean {
  if (!value) {
    return false;
  }

  return value >= start && value <= end;
}

/** When a task was acted on: its due time, else its last update, else its creation. */
export function taskActionDate(task: AmoCRMTask): Date | null {
  return toActivityDate(task.complete_till) || toActivityDate(task.updated_at) || toActivityDate(task.created_at);
}

export function eventActorUserId(event: AmoCRMEvent): string {
  return toStringId(event.created_by || event.user_id || event.responsible_user_id);
}

export function eventDate(event: AmoCRMEvent): Date | null {
  return toActivityDate(event.created_at || event.createdAt || event.date_create);
}

/** True when any string inside `value` (searched through arrays and object values) contains `token`, ignoring case. */
export function hasText(value: unknown, token: string): boolean {
  if (typeof value === 'string') {
    return value.toLowerCase().includes(token);
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasText(item, token));
  }
  const record = asObject(value);

  return record ? Object.values(record).some((item) => hasText(item, token)) : false;
}

function eventTypeText(event: AmoCRMEvent): string {
  return toStringId(event.type || event.event_type || event.name).toLowerCase();
}

/** A note event: its type mentions "note", or any of its text does. */
export function isNoteEvent(event: AmoCRMEvent): boolean {
  return eventTypeText(event).includes('note') || hasText(event, 'note');
}

/** Fields whose presence marks a stage change (the before/after values only when they mention a stage). */
const STAGE_CHANGE_KEYS = [
  'status_id',
  'status_before',
  'status_after',
  'pipeline_id',
  'pipeline_before',
  'pipeline_after',
  'value_before',
  'value_after',
] as const;

function isBlankField(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

function mentionsStage(value: unknown): boolean {
  return hasText(value, 'status') || hasText(value, 'pipeline') || hasText(value, 'stage');
}

/**
 * A stage change: its type mentions status / stage / pipeline, or the first non-blank stage field is a
 * status / pipeline id, or a before / after value that mentions a stage.
 */
export function isStageChangeEvent(event: AmoCRMEvent): boolean {
  const eventType = eventTypeText(event);

  if (eventType.includes('status') || eventType.includes('stage') || eventType.includes('pipeline')) {
    return true;
  }

  for (const key of STAGE_CHANGE_KEYS) {
    if (!(key in event) || isBlankField(event[key])) {
      continue;
    }
    if (key !== 'value_before' && key !== 'value_after') {
      return true;
    }
    if (mentionsStage(event[key])) {
      return true;
    }
  }

  return false;
}

/** Counts completed lead tasks acted on within the range as follow-ups. */
export function countCompletedFollowUps(metricsByManager: ActivityMetricsByManager, tasks: AmoCRMTask[], range: ActivityPeriod): void {
  for (const task of tasks) {
    if (!isCompletedTask(task) || !isLeadTask(task)) continue;
    const metrics = metricsByManager.get(taskResponsibleUserId(task));

    if (metrics && isWithinRange(taskActionDate(task), range.start, range.end)) {
      metrics.followUpCount += 1;
    }
  }
}

/** Open lead tasks: due before today counts as overdue, due within `period` as a due follow-up. */
export function countOpenFollowUps(
  metricsByManager: ActivityMetricsByManager,
  tasks: AmoCRMTask[],
  todayStart: Date,
  period: ActivityPeriod,
): void {
  for (const task of tasks) {
    if (!isLeadTask(task) || isCompletedTask(task)) continue;
    const metrics = metricsByManager.get(taskResponsibleUserId(task));
    const dueDate = toActivityDate(task.complete_till);

    if (!dueDate || !metrics) continue;
    if (dueDate < todayStart) {
      metrics.overdueFollowUpCount += 1;
    } else if (dueDate >= period.start && dueDate <= period.end) {
      metrics.todayFollowUpCount += 1;
    }
  }
}

/** Events within the range: a note event counts as a note, otherwise a stage change as a stage change. */
export function countEventActivity(metricsByManager: ActivityMetricsByManager, events: AmoCRMEvent[], range: ActivityPeriod): void {
  for (const event of events) {
    const metrics = metricsByManager.get(eventActorUserId(event));

    if (!metrics || !isWithinRange(eventDate(event), range.start, range.end)) continue;
    if (isNoteEvent(event)) {
      metrics.noteCount += 1;
    } else if (isStageChangeEvent(event)) {
      metrics.stageChangeCount += 1;
    }
  }
}

/** Sums the counters of all managers. */
export function summarizeAmoCRMActivityMetrics(metricsByManager: ActivityMetricsByManager): AmoCRMActivityMetrics {
  const totals = createEmptyMetrics();

  for (const metrics of metricsByManager.values()) {
    totals.followUpCount += metrics.followUpCount;
    totals.noteCount += metrics.noteCount;
    totals.stageChangeCount += metrics.stageChangeCount;
    totals.overdueFollowUpCount += metrics.overdueFollowUpCount;
    totals.todayFollowUpCount += metrics.todayFollowUpCount;
  }

  return totals;
}

/** Why a source could not be read: `timeout`, `network_error`, or `fetch_failed` (also for our own HTTP-status errors). */
export function activityFailureReason(error: unknown): string {
  const message = String(asObject(error)?.message || error || '').toLowerCase();

  if (message.includes('timeout')) return 'timeout';
  // Our own HTTP-status errors read "Failed to fetch AmoCRM ...: <status>" — those are API errors, not network errors.
  if (message.startsWith('failed to fetch amocrm')) return 'fetch_failed';
  if (message.includes('network') || message.includes('fetch failed')) return 'network_error';

  return 'fetch_failed';
}
