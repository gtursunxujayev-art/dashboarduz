import { courseCategoryLabel, courseTypeCategorySchema } from '@dashboarduz/shared';
import { z } from 'zod';

import { describeCourse, loadActiveCourseCatalog } from '../../../services/course-sales/catalog';
import { protectedProcedure } from '../../trpc';

export const courseSalesOptionProcedures = {
  options: protectedProcedure.query(async ({ ctx }) => {
    const courses = await loadActiveCourseCatalog({ db: ctx.db, tenantId: ctx.tenantId });

    return {
      courses: courses.map((course) => ({ ...course, ...describeCourse(course) })),
    };
  }),
  typeOptions: protectedProcedure
    .input(
      z.object({
        category: courseTypeCategorySchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const courses = await loadActiveCourseCatalog({ db: ctx.db, tenantId: ctx.tenantId, category: input.category });

      return {
        category: input.category,
        categoryLabel: courseCategoryLabel(input.category),
        courses: courses.map((course) => ({ ...course, ...describeCourse(course) })),
      };
    }),
};
