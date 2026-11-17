import { courseTypeCategorySchema, isAgentOnly } from '@dashboarduz/shared';
import { z } from 'zod';

import { emptyCustomerPage, listCourseSaleCustomers } from '../../../services/course-sales/customer-list';
import { buildCourseSaleFilters, findCategoryCourseIds } from '../../../services/course-sales/queries';
import { protectedProcedure } from '../../trpc';

export const courseSalesTypeCustomerProcedures = {
  typeCustomers: protectedProcedure
    .input(
      z.object({
        category: courseTypeCategorySchema,
        courseId: z.string().uuid().optional(),
        tariffId: z.string().uuid().optional(),
        subTariffId: z.string().uuid().optional(),
        query: z.string().trim().max(120).optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const categoryCourseIds = await findCategoryCourseIds(ctx.db, ctx.tenantId, input.category);

      if (categoryCourseIds.length === 0) {
        return emptyCustomerPage(input.page, input.limit);
      }

      const filters = await buildCourseSaleFilters({
        db: ctx.db,
        tenantId: ctx.tenantId,
        courseId: input.courseId,
        categoryCourseIds,
        tariffId: input.tariffId,
        subTariffId: input.subTariffId,
      });

      return listCourseSaleCustomers({
        db: ctx.db,
        tenantId: ctx.tenantId,
        scopedManagerUserId: isAgentOnly(ctx.user.roles) ? ctx.user.userId : undefined,
        filters,
        query: input.query?.trim(),
        page: input.page,
        limit: input.limit,
      });
    }),
};
