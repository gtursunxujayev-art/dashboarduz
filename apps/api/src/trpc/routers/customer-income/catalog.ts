import { createCourseSchema, createTariffSchema } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { fetchCoursesWithTariffsSafe } from '../../../services/customer-income/catalog';
import { COURSE_CATEGORY_VALUES } from '../../../services/customer-income/constants';
import { parseDateInput } from '../../../services/customer-income/labels';
import { assertCourseCategoryInScope, canEditCourseCatalog, catalogScope } from '../../../services/customer-income/scope';
import { protectedProcedure } from '../../trpc';

/** Admin, Manager and OnlineAdmin (online courses only); team leaders only read the catalog. */
const catalogEditorProcedure = protectedProcedure.use(async (opts) => {
  if (!canEditCourseCatalog(opts.ctx.user?.roles || [])) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin or Manager access required' });
  }

  return opts.next();
});

/** `{ name, isActive }` to update from a rename/activate input (`isFaol` is the older name of `isActive`). */
function buildNameActiveUpdate(input: { name?: string; isActive?: boolean; isFaol?: boolean }): { name?: string; isActive?: boolean } {
  const data: { name?: string; isActive?: boolean } = {};

  if (typeof input.name === 'string') {
    data.name = input.name.trim();
  }
  if (typeof input.isActive === 'boolean') {
    data.isActive = input.isActive;
  } else if (typeof input.isFaol === 'boolean') {
    data.isActive = input.isFaol;
  }

  if (!Object.keys(data).length) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'No fields to update.' });
  }

  return data;
}

export const catalogProcedures = {
  createCourse: catalogEditorProcedure
    .input(createCourseSchema)
    .mutation(async ({ ctx, input }) => {
      const name = input.name.trim();

      if (!name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course name is required.' });
      }
      const scope = catalogScope(ctx.user.roles);

      assertCourseCategoryInScope(scope, input.category);
      if (scope.kind === 'group') {
        // Re-creating by name updates the existing course; OnlineAdmin must not take over a non-online one.
        const existing = await ctx.db.course.findFirst({ where: { tenantId: ctx.tenantId, name }, select: { category: true } });

        if (existing) {
          assertCourseCategoryInScope(scope, existing.category);
        }
      }
      const startDate = input.startDate ? parseDateInput(input.startDate) : null;
      const endDate = input.endDate ? parseDateInput(input.endDate) : null;

      if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Kurs tugash sanasi boshlanish sanasidan oldin bo'lishi mumkin emas.",
        });
      }

      return ctx.db.course.upsert({
        where: {
          tenantId_name: {
            tenantId: ctx.tenantId,
            name,
          },
        },
        create: {
          tenantId: ctx.tenantId,
          name,
          category: input.category,
          startDate,
          endDate,
          isActive: true,
        },
        update: {
          category: input.category,
          startDate,
          endDate,
          isActive: true,
        },
      });
    }),
  createTariff: catalogEditorProcedure
    .input(createTariffSchema)
    .mutation(async ({ ctx, input }) => {
      const course = await ctx.db.course.findFirst({
        where: {
          id: input.courseId,
          tenantId: ctx.tenantId,
          isActive: true,
        },
        select: { id: true, category: true },
      });

      if (!course) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course not found.' });
      }
      assertCourseCategoryInScope(catalogScope(ctx.user.roles), course.category);

      const name = input.name.trim();

      if (!name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tariff name is required.' });
      }

      return ctx.db.tariff.upsert({
        where: {
          tenantId_courseId_name: {
            tenantId: ctx.tenantId,
            courseId: input.courseId,
            name,
          },
        },
        create: {
          tenantId: ctx.tenantId,
          courseId: input.courseId,
          name,
          isActive: true,
        },
        update: {
          isActive: true,
        },
      });
    }),
  createSubTariff: catalogEditorProcedure
    .input(
      z.object({
        tariffId: z.string().uuid(),
        name: z.string().min(1).max(120),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tariff = await ctx.db.tariff.findFirst({
        where: {
          id: input.tariffId,
          tenantId: ctx.tenantId,
          isActive: true,
        },
        select: { id: true, course: { select: { category: true } } },
      });

      if (!tariff) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tariff not found.' });
      }
      assertCourseCategoryInScope(catalogScope(ctx.user.roles), tariff.course?.category);

      const name = input.name.trim();

      if (!name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Sub-tariff name is required.' });
      }

      return ctx.db.subTariff.upsert({
        where: {
          tenantId_tariffId_name: {
            tenantId: ctx.tenantId,
            tariffId: input.tariffId,
            name,
          },
        },
        create: {
          tenantId: ctx.tenantId,
          tariffId: input.tariffId,
          name,
          isActive: true,
        },
        update: {
          isActive: true,
        },
      });
    }),
  courseCatalog: protectedProcedure.query(async ({ ctx }) => {
    return fetchCoursesWithTariffsSafe({
      tenantId: ctx.tenantId,
      onlyActive: false,
      db: ctx.db,
    });
  }),
  updateCourse: catalogEditorProcedure
    .input(
      z.object({
        courseId: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        category: z.enum(COURSE_CATEGORY_VALUES).optional(),
        startDate: z.string().optional().nullable(),
        endDate: z.string().optional().nullable(),
        isActive: z.boolean().optional(),
        isFaol: z.boolean().optional(),
        isHiddenFromIncomeForm: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const course = await ctx.db.course.findFirst({
        where: {
          id: input.courseId,
          tenantId: ctx.tenantId,
        },
        select: { id: true, category: true },
      });

      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' });
      }
      const scope = catalogScope(ctx.user.roles);

      // OnlineAdmin: only online courses, and they stay online.
      assertCourseCategoryInScope(scope, course.category);
      if (typeof input.category === 'string') {
        assertCourseCategoryInScope(scope, input.category);
      }

      const data: {
        name?: string;
        category?: string;
        startDate?: Date | null;
        endDate?: Date | null;
        isActive?: boolean;
        isHiddenFromIncomeForm?: boolean;
      } = {};

      if (typeof input.name === 'string') {
        data.name = input.name.trim();
      }
      if (typeof input.category === 'string') {
        data.category = input.category;
      }
      if (input.startDate !== undefined) {
        data.startDate = input.startDate ? parseDateInput(input.startDate) : null;
      }
      if (input.endDate !== undefined) {
        data.endDate = input.endDate ? parseDateInput(input.endDate) : null;
      }
      if (
        data.startDate !== undefined
        && data.endDate !== undefined
        && data.startDate
        && data.endDate
        && data.endDate.getTime() < data.startDate.getTime()
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Kurs tugash sanasi boshlanish sanasidan oldin bo'lishi mumkin emas.",
        });
      }
      if (typeof input.isActive === 'boolean') {
        data.isActive = input.isActive;
      } else if (typeof input.isFaol === 'boolean') {
        data.isActive = input.isFaol;
      }
      if (typeof input.isHiddenFromIncomeForm === 'boolean') {
        data.isHiddenFromIncomeForm = input.isHiddenFromIncomeForm;
      }

      if (!Object.keys(data).length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No fields to update.' });
      }

      return ctx.db.course.update({
        where: { id: input.courseId },
        data,
      });
    }),
  updateTariff: catalogEditorProcedure
    .input(
      z.object({
        tariffId: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        isActive: z.boolean().optional(),
        isFaol: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tariff = await ctx.db.tariff.findFirst({
        where: {
          id: input.tariffId,
          tenantId: ctx.tenantId,
        },
        select: { id: true, course: { select: { category: true } } },
      });

      if (!tariff) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tariff not found.' });
      }
      assertCourseCategoryInScope(catalogScope(ctx.user.roles), tariff.course?.category);

      const data = buildNameActiveUpdate(input);

      return ctx.db.tariff.update({
        where: { id: input.tariffId },
        data,
      });
    }),
  updateSubTariff: catalogEditorProcedure
    .input(
      z.object({
        subTariffId: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        isActive: z.boolean().optional(),
        isFaol: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const subTariff = await ctx.db.subTariff.findFirst({
        where: {
          id: input.subTariffId,
          tenantId: ctx.tenantId,
        },
        select: { id: true, tariff: { select: { course: { select: { category: true } } } } },
      });

      if (!subTariff) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Sub-tariff not found.' });
      }
      assertCourseCategoryInScope(catalogScope(ctx.user.roles), subTariff.tariff?.course?.category);

      const data = buildNameActiveUpdate(input);

      return ctx.db.subTariff.update({
        where: { id: input.subTariffId },
        data,
      });
    }),
};
