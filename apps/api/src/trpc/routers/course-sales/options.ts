import { courseTypeCategorySchema } from '@dashboarduz/shared';
import { z } from 'zod';

import { buildCategoryLabel } from '../../../services/course-sales/helpers';
import { protectedProcedure } from '../../trpc';

export const courseSalesOptionProcedures = {
  options: protectedProcedure.query(async ({ ctx }) => {
    const courses = await ctx.db.course.findMany({
      where: {
        tenantId: ctx.tenantId,
        isActive: true,
      },
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        name: true,
        category: true,
        tariffs: {
          where: { isActive: true },
          orderBy: [{ name: 'asc' }],
          select: {
            id: true,
            name: true,
            subTariffs: {
              where: { isActive: true },
              orderBy: [{ name: 'asc' }],
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    return {
      courses: courses.map((course) => ({
        id: course.id,
        name: course.name,
        category: String(course.category || '').trim().toLowerCase(),
        categoryLabel: buildCategoryLabel(String(course.category || '')),
        tariffs: course.tariffs.map((tariff) => ({
          id: tariff.id,
          name: tariff.name,
          subTariffs: tariff.subTariffs.map((subTariff) => ({
            id: subTariff.id,
            name: subTariff.name,
          })),
        })),
      })),
    };
  }),
  typeOptions: protectedProcedure
    .input(
      z.object({
        category: courseTypeCategorySchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const courses = await ctx.db.course.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          category: input.category,
        },
        orderBy: [{ name: 'asc' }],
        select: {
          id: true,
          name: true,
          category: true,
          tariffs: {
            where: { isActive: true },
            orderBy: [{ name: 'asc' }],
            select: {
              id: true,
              name: true,
              subTariffs: {
                where: { isActive: true },
                orderBy: [{ name: 'asc' }],
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      return {
        category: input.category,
        categoryLabel: buildCategoryLabel(input.category),
        courses: courses.map((course) => ({
          id: course.id,
          name: course.name,
          category: String(course.category || '').trim().toLowerCase(),
          categoryLabel: buildCategoryLabel(String(course.category || '')),
          tariffs: course.tariffs.map((tariff) => ({
            id: tariff.id,
            name: tariff.name,
            subTariffs: tariff.subTariffs.map((subTariff) => ({
              id: subTariff.id,
              name: subTariff.name,
            })),
          })),
        })),
      };
    }),
};
