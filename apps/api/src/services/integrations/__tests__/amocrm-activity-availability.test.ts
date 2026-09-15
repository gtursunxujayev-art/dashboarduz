import { amocrmService } from '../amocrm';
import {
  createAmoCRMActivityDiagnostics,
  getAmoCRMActivityMetrics,
} from '../amocrm-activity';

describe('AmoCRM activity availability', () => {
  afterEach(() => jest.restoreAllMocks());

  it('preserves successful sources and marks only a failed source unavailable', async () => {
    jest.spyOn(amocrmService, 'fetchAllTasks')
      .mockRejectedValueOnce(new Error('completed task fetch failed'))
      .mockRejectedValueOnce(new Error('completed task fallback failed'))
      .mockResolvedValueOnce([] as never);
    jest.spyOn(amocrmService, 'fetchAllEvents').mockResolvedValue([] as never);
    const diagnostics = createAmoCRMActivityDiagnostics();

    const result = await getAmoCRMActivityMetrics({
      tenantId: 'availability-test',
      accessToken: 'token',
      managerIds: ['10'],
      rangeStart: new Date('2026-09-15T00:00:00.000Z'),
      rangeEnd: new Date('2026-09-15T23:59:59.999Z'),
      diagnostics,
    });

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
});
