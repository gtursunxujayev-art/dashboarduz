import { describe, expect, it } from '@jest/globals';
import {
  buildFunnelQueryInput,
  formatCount,
  isStageRefValid,
  parseStageRef,
  parseStoredFilters,
  serializeFilters,
  serializeStageRef,
  stagePipelines,
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
    const base = { dateFrom: '', dateTo: '', group: 'online' as const, pipelineId: null, taklif: null, refreshKey: 0 };
    expect(buildFunnelQueryInput({ ...base, range: 'last_week' }, now)).toMatchObject({
      range: 'custom', dateFrom: '2026-10-26', dateTo: '2026-11-01', group: 'online',
    });
    const preset = buildFunnelQueryInput({ ...base, range: 'month' }, now);
    expect(preset.range).toBe('month');
    expect(preset).not.toHaveProperty('dateFrom');
  });

  describe('saved filters', () => {
    const pipelines = [
      { id: '10', name: 'Online', statuses: [{ id: '20', name: 'Malumot berildi' }, { id: '30', name: 'Qiziqish' }] },
      { id: '11', name: 'Oflayn', statuses: [{ id: '40', name: 'Uchrashuv' }] },
    ];
    const defaults = {
      range: 'month' as const, dateFrom: '2026-11-07', dateTo: '2026-11-07', group: 'all' as const,
      pipelineId: null, taklif: null,
    };

    it('round-trips every filter', () => {
      const filters = {
        range: 'custom' as const, dateFrom: '2026-10-19', dateTo: '2026-11-07', group: 'online' as const,
        pipelineId: '10', taklif: { pipelineId: '10', statusId: '30' },
      };
      expect(parseStoredFilters(serializeFilters(filters), defaults, pipelines)).toEqual(filters);
    });

    it('falls back to defaults for garbage or missing storage', () => {
      expect(parseStoredFilters('not json', defaults, pipelines)).toEqual(defaults);
      expect(parseStoredFilters(null, defaults, pipelines)).toEqual(defaults);
      expect(parseStoredFilters(JSON.stringify({ range: 'year', group: 'x', dateFrom: '19.10.2026' }), defaults, pipelines)).toEqual(defaults);
    });

    it('drops a removed funnel and stages outside the chosen funnel', () => {
      const stored = JSON.stringify({ pipelineId: '99', taklif: '10:20' });
      expect(parseStoredFilters(stored, defaults, pipelines)).toMatchObject({ pipelineId: null, taklif: { pipelineId: '10', statusId: '20' } });
      const scoped = JSON.stringify({ pipelineId: '10', taklif: '11:40' });
      expect(parseStoredFilters(scoped, defaults, pipelines)).toMatchObject({ pipelineId: '10', taklif: null });
    });

    it('limits stage options to the chosen funnel', () => {
      expect(stagePipelines(pipelines, '11').map((pipeline) => pipeline.id)).toEqual(['11']);
      expect(stagePipelines(pipelines, null)).toHaveLength(2);
    });
  });

  it('formats unknown counts as a dash', () => {
    expect(formatCount(null)).toBe('—');
    expect(formatCount(0)).toBe('0');
  });
});
