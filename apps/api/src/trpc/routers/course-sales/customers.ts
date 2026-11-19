import { dateRangeInput, reportRangeSchema } from '@dashboarduz/shared';
import { z } from 'zod';

import { resolveDateRange } from '../../../lib/dates';
import { listCourseSaleCustomers } from '../../../services/course-sales/customer-list';
import { buildCourseSaleFilters, resolveCourseSalesManagerScope } from '../../../services/course-sales/queries';
import { protectedProcedure } from '../../trpc';

export const courseSalesCustomerProcedures = {
  customers: protectedProcedure
    .input(
      z.object({
        courseId: z.string().uuid(),
        tariffId: z.string().uuid().optional(),
        subTariffId: z.string().uuid().optional(),
        range: reportRangeSchema.default('month'),
        ...dateRangeInput.shape,
        query: z.string().trim().max(120).optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, new Date(), input.dateFrom, input.dateTo);
      const filters = await buildCourseSaleFilters({
        db: ctx.db,
        tenantId: ctx.tenantId,
        courseId: input.courseId,
        tariffId: input.tariffId,
        subTariffId: input.subTariffId,
      });

      return listCourseSaleCustomers({
        db: ctx.db,
        tenantId: ctx.tenantId,
        scopedManagerUserIds: await resolveCourseSalesManagerScope(ctx),
        filters,
        entryDate: { gte: rangeStart, lte: rangeEnd },
        query: input.query?.trim(),
        page: input.page,
        limit: input.limit,
      });
    }),
};
