import {
  BONUS_DETAIL_EXPORT_LIMIT,
  buildBonusDetailIncomeWhere,
  isBonusDetailExportOverLimit,
} from '../bonus-detail-export';

describe('bonus detail export filters', () => {
  it('builds tenant, manager, date, course, lifecycle, and technical-row filters', () => {
    const rangeStart = new Date('2026-07-01T00:00:00.000Z');
    const rangeEnd = new Date('2026-07-31T23:59:59.999Z');
    const where = buildBonusDetailIncomeWhere({
      tenantId: 'tenant-a',
      managerUserIds: ['agent-a'],
      rangeStart,
      rangeEnd,
      courseId: 'course-a',
      technicalSaleIds: ['technical-sale'],
    });

    expect(where).toEqual({
      tenantId: 'tenant-a',
      lifecycleStatus: 'active',
      managerUserId: { in: ['agent-a'] },
      courseId: 'course-a',
      entryDate: { gte: rangeStart, lte: rangeEnd },
      NOT: {
        OR: [
          { id: { in: ['technical-sale'] } },
          { relatedDebtIncomeId: { in: ['technical-sale'] } },
        ],
      },
    });
  });

  it('omits optional course and technical filters when none are selected', () => {
    const where = buildBonusDetailIncomeWhere({
      tenantId: 'tenant-a',
      managerUserIds: ['agent-a', 'agent-b'],
      rangeStart: new Date('2026-08-01T00:00:00.000Z'),
      rangeEnd: new Date('2026-08-31T23:59:59.999Z'),
    });

    expect(where).not.toHaveProperty('courseId');
    expect(where).not.toHaveProperty('NOT');
    expect(where.managerUserId).toEqual({ in: ['agent-a', 'agent-b'] });
  });

  it('accepts 20,000 rows and rejects the next row', () => {
    expect(isBonusDetailExportOverLimit(BONUS_DETAIL_EXPORT_LIMIT)).toBe(false);
    expect(isBonusDetailExportOverLimit(BONUS_DETAIL_EXPORT_LIMIT + 1)).toBe(true);
  });
});
