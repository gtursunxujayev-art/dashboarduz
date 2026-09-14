import { prisma } from '../dashboard/helpers';
import {
  loadSelectedReportCourses,
  parseTelegramDailyReportCourseIds,
} from '../dashboard/selected-report-courses';

describe('selected report courses', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes, de-duplicates, and limits configured course ids', () => {
    expect(parseTelegramDailyReportCourseIds({
      telegramDailyReportCourseIds: [' online ', 'offline', 'online', '', 'intensive', 'ignored'],
    })).toEqual(['online', 'offline', 'intensive']);
    expect(parseTelegramDailyReportCourseIds(null)).toEqual([]);
  });

  it('keeps configuration order, aggregates all-time active sales, and excludes technical sales', async () => {
    jest.spyOn(prisma.integration, 'findUnique').mockResolvedValue({
      status: 'active',
      config: { telegramDailyReportCourseIds: ['course-online', 'course-offline', 'course-intensive'] },
    } as never);
    jest.spyOn(prisma.course, 'findMany').mockResolvedValue([
      { id: 'course-offline', name: 'Offline-Sentyabr', category: 'offline', tariffs: [{ id: 'standard', name: 'Standart' }] },
      { id: 'course-intensive', name: 'Intensiv-2026', category: 'intensive', tariffs: [] },
      { id: 'course-online', name: 'Online-Sentyabr', category: 'online', tariffs: [{ id: 'premium', name: 'Premium' }] },
    ] as never);
    jest.spyOn(prisma.income, 'findMany')
      .mockResolvedValueOnce([
        {
          id: 'online-sale', type: 'new_sale', relatedDebtIncomeId: null, courseId: 'course-online',
          tariffId: 'premium', coursePriceAmount: 10_000_000, paymentAmount: 2_000_000,
        },
        {
          id: 'online-fallback', type: 'new_sale', relatedDebtIncomeId: null, courseId: 'course-online',
          tariffId: null, coursePriceAmount: null, paymentAmount: 3_000_000,
        },
        {
          id: 'technical-sale', type: 'new_sale', relatedDebtIncomeId: null, courseId: 'course-offline',
          tariffId: 'standard', coursePriceAmount: 1, paymentAmount: 1,
        },
        {
          id: 'intensive-sale', type: 'new_sale', relatedDebtIncomeId: null, courseId: 'course-intensive',
          tariffId: null, coursePriceAmount: 4_000_000, paymentAmount: 1_000_000,
        },
      ] as never)
      .mockResolvedValueOnce([
        { id: 'technical-sale', type: 'new_sale', coursePriceAmount: 1, debtAmount: 0, paymentAmount: 1 },
      ] as never);

    const result = await loadSelectedReportCourses('tenant-1');

    expect(prisma.course.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-1' }),
    }));
    expect(result.map((course) => course.courseId)).toEqual([
      'course-online',
      'course-offline',
      'course-intensive',
    ]);
    expect(result[0]).toEqual(expect.objectContaining({
      dashboardCategory: 'online',
      group: 'online',
      salesCount: 2,
      agreementAmount: 13_000_000,
    }));
    expect(result[0]?.tariffs).toEqual([
      { tariffId: 'premium', name: 'Premium', salesCount: 1 },
      { tariffId: null, name: 'Tarifsiz', salesCount: 1 },
    ]);
    expect(result[1]).toEqual(expect.objectContaining({ salesCount: 0, agreementAmount: 0 }));
    expect(result[2]).toEqual(expect.objectContaining({
      dashboardCategory: 'intensive',
      group: 'offline',
      salesCount: 1,
      agreementAmount: 4_000_000,
    }));
  });

  it('returns no courses when the Telegram integration is inactive', async () => {
    jest.spyOn(prisma.integration, 'findUnique').mockResolvedValue({
      status: 'inactive',
      config: { telegramDailyReportCourseIds: ['course-online'] },
    } as never);
    const courseSpy = jest.spyOn(prisma.course, 'findMany');

    await expect(loadSelectedReportCourses('tenant-1')).resolves.toEqual([]);
    expect(courseSpy).not.toHaveBeenCalled();
  });
});
