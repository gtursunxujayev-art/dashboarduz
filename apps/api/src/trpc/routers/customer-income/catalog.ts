import { createCourseSchema, createTariffSchema } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { fetchCoursesWithTariffsSafe } from '../../../services/customer-income/catalog';
import { COURSE_CATEGORY_VALUES } from '../../../services/customer-income/constants';
import { parseDateInput } from '../../../services/customer-income/labels';
import { managerProcedure, protectedProcedure } from '../../trpc';

export const catalogProcedures = {
  createCourse: managerProcedure
    .input(createCourseSchema)
    .mutation(async ({ ctx, input }) => {
      const name = input.name.trim();

      if (!name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course name is required.' });
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
  createTariff: managerProcedure
    .input(createTariffSchema)
    .mutation(async ({ ctx, input }) => {
      const course = await ctx.db.course.findFirst({
        where: {
          id: input.courseId,
          tenantId: ctx.tenantId,
          isActive: true,
        },
        select: { id: true },
      });

      if (!course) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course not found.' });
      }

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
  createSubTariff: managerProcedure
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
        select: { id: true },
      });

      if (!tariff) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tariff not found.' });
      }

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
  updateCourse: managerProcedure
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
        select: { id: true },
      });

      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' });
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
  updateTariff: managerProcedure
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
        select: { id: true },
      });

      if (!tariff) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tariff not found.' });
      }

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

      return ctx.db.tariff.update({
        where: { id: input.tariffId },
        data,
      });
    }),
  updateSubTariff: managerProcedure
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
        select: { id: true },
      });

      if (!subTariff) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Sub-tariff not found.' });
      }

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

      return ctx.db.subTariff.update({
        where: { id: input.subTariffId },
        data,
      });
    }),
};
