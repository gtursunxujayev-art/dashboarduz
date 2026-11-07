import { describe, expect, it } from '@jest/globals';
import {
  buildFunnelQueryInput,
  formatCount,
  isStageRefValid,
  parseStageRef,
  serializeStageRef,
} from './funnel-view';

const now = new Date('2026-11-07T06:00:00Z');

describe('funnel view helpers', () => {
  it('round-trips stage refs and rejects malformed values', () => {
    const ref = { pipelineId: '10', statusId: '20' };
    expect(parseStageRef(serializeStageRef(ref))).toEqual(ref);
    expect(serializeStageRef(null)).toBe('');
    expect(parseStageRef('')).toBeNull();
    expect(parseStageRef('abc')).toBeNull();
    expect(parseStageRef('1:')).toBeNull();
    expect(parseStageRef('1:2:3')).toBeNull();
  });

  it('validates a stored stage against current pipelines', () => {
    const pipelines = [{ id: '10', name: 'Sotuv', statuses: [{ id: '20', name: 'Aloqa' }] }];
    expect(isStageRefValid({ pipelineId: '10', statusId: '20' }, pipelines)).toBe(true);
    expect(isStageRefValid({ pipelineId: '10', statusId: '99' }, pipelines)).toBe(false);
    expect(isStageRefValid(null, pipelines)).toBe(false);
  });

  it('builds the API input, converting last week to a custom range', () => {
    const base = { dateFrom: '', dateTo: '', group: 'online' as const, ishlangan: null, taklif: null, refreshKey: 0 };
    expect(buildFunnelQueryInput({ ...base, range: 'last_week' }, now)).toMatchObject({
      range: 'custom', dateFrom: '2026-10-26', dateTo: '2026-11-01', group: 'online',
    });
    const preset = buildFunnelQueryInput({ ...base, range: 'month' }, now);
    expect(preset.range).toBe('month');
    expect(preset).not.toHaveProperty('dateFrom');
  });

  it('formats unknown counts as a dash', () => {
    expect(formatCount(null)).toBe('—');
    expect(formatCount(0)).toBe('0');
  });
});
