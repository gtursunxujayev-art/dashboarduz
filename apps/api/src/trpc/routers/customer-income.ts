import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import {
  createCourseSchema,
  createIncomeSchema,
  createTariffSchema,
  customerSearchSchema,
} from '@dashboarduz/shared';
import { z } from 'zod';
import { protectedProcedure, router } from '../trpc';

const SALES_MANAGER_ROLES = ['Admin', 'Manager', 'Agent'] as const;

function parseDateInput(input: string): Date {
  const value = input.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid date: ${input}` });
  }

  return date;
}

async function assertManagerBelongsToTenant(tenantId: string, managerUserId: string) {
  const manager = await prisma.user.findFirst({
    where: {
      id: managerUserId,
      tenantId,
      isActive: true,
      roles: {
        hasSome: [...SALES_MANAGER_ROLES],
      },
    },
    select: {
      id: true,
    },
  });

  if (!manager) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected sales manager is not available.' });
  }
}

export const customerIncomeRouter = router({
  formOptions: protectedProcedure.query(async ({ ctx }) => {
    const [managers, customers, courses, outstandingDebts] = await Promise.all([
      prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          roles: {
            hasSome: [...SALES_MANAGER_ROLES],
          },
        },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          username: true,
          roles: true,
        },
      }),
      prisma.customer.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { createdAt: 'desc' },
        take: 300,
        select: {
          id: true,
          customerNumber: true,
          name: true,
          telegramUsername: true,
        },
      }),
      prisma.course.findMany({
        where: { tenantId: ctx.tenantId, isActive: true },
        orderBy: { name: 'asc' },
        include: {
          tariffs: {
            where: { isActive: true },
            orderBy: { name: 'asc' },
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          remainingDebtAmount: { gt: 0 },
        },
        orderBy: { entryDate: 'desc' },
        take: 300,
        select: {
          id: true,
          remainingDebtAmount: true,
          debtAmount: true,
          customer: {
            select: {
              customerNumber: true,
              name: true,
            },
          },
          course: {
            select: { name: true },
          },
          tariff: {
            select: { name: true },
          },
        },
      }),
    ]);

    return {
      managers: managers.map((manager) => ({
        id: manager.id,
        label: manager.name || manager.username || manager.id,
        roles: manager.roles,
      })),
      customers,
      courses: courses.map((course) => ({
        id: course.id,
        name: course.name,
        tariffs: course.tariffs,
      })),
      outstandingDebts: outstandingDebts.map((debt) => ({
        id: debt.id,
        remainingDebtAmount: debt.remainingDebtAmount,
        debtAmount: debt.debtAmount,
        customerNumber: debt.customer.customerNumber,
        customerName: debt.customer.name,
        courseName: debt.course?.name || null,
        tariffName: debt.tariff?.name || null,
      })),
    };
  }),

  searchCustomers: protectedProcedure
    .input(customerSearchSchema)
    .query(async ({ ctx, input }) => {
      const query = input.query?.trim();
      return prisma.customer.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(query
            ? {
                OR: [
                  { customerNumber: { contains: query, mode: 'insensitive' } },
                  { name: { contains: query, mode: 'insensitive' } },
                  { telegramUsername: { contains: query, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        select: {
          id: true,
          customerNumber: true,
          name: true,
          telegramUsername: true,
        },
      });
    }),

  createCourse: protectedProcedure
    .input(createCourseSchema)
    .mutation(async ({ ctx, input }) => {
      const name = input.name.trim();
      if (!name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course name is required.' });
      }

      return prisma.course.upsert({
        where: {
          tenantId_name: {
            tenantId: ctx.tenantId,
            name,
          },
        },
        create: {
          tenantId: ctx.tenantId,
          name,
          isActive: true,
        },
        update: {
          isActive: true,
        },
      });
    }),

  createTariff: protectedProcedure
    .input(createTariffSchema)
    .mutation(async ({ ctx, input }) => {
      const course = await prisma.course.findFirst({
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

      return prisma.tariff.upsert({
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

  createIncome: protectedProcedure
    .input(createIncomeSchema)
    .mutation(async ({ ctx, input }) => {
      await assertManagerBelongsToTenant(ctx.tenantId, input.managerUserId);
      const entryDate = parseDateInput(input.entryDate);
      const deadline = input.deadline ? parseDateInput(input.deadline) : null;
      const customerNumber = input.customerNumber.trim();

      if (input.paymentAmount < 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Payment amount cannot be negative.' });
      }

      let customer = await prisma.customer.findUnique({
        where: {
          tenantId_customerNumber: {
            tenantId: ctx.tenantId,
            customerNumber,
          },
        },
      });

      if (!customer) {
        if (input.type === 'repayment') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Repayment can only be added for an existing customer debt.',
          });
        }

        if (!input.customerName?.trim()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Customer name is required for a new customer number.',
          });
        }

        customer = await prisma.customer.create({
          data: {
            tenantId: ctx.tenantId,
            customerNumber,
            name: input.customerName.trim(),
            telegramUsername: input.telegramUsername?.trim() || null,
          },
        });
      }

      let createdIncome;

      if (input.type === 'new_sale') {
        if (!input.courseId || !input.tariffId || input.coursePriceAmount === undefined) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Course, tariff, and course price are required for a new sale.',
          });
        }

        if (input.coursePriceAmount < 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course price cannot be negative.' });
        }

        const [course, tariff] = await Promise.all([
          prisma.course.findFirst({
            where: { id: input.courseId, tenantId: ctx.tenantId, isActive: true },
            select: { id: true },
          }),
          prisma.tariff.findFirst({
            where: { id: input.tariffId, tenantId: ctx.tenantId, courseId: input.courseId, isActive: true },
            select: { id: true },
          }),
        ]);

        if (!course || !tariff) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course or tariff not found.' });
        }

        const remainingDebtAmount = Math.max(input.coursePriceAmount - input.paymentAmount, 0);
        createdIncome = await prisma.income.create({
          data: {
            tenantId: ctx.tenantId,
            customerId: customer.id,
            managerUserId: input.managerUserId,
            type: 'new_sale',
            courseId: input.courseId,
            tariffId: input.tariffId,
            entryDate,
            deadline: remainingDebtAmount > 0 ? deadline : null,
            coursePriceAmount: input.coursePriceAmount,
            debtAmount: input.coursePriceAmount,
            paymentAmount: input.paymentAmount,
            remainingDebtAmount,
          },
        });
      } else {
        if (!input.debtSourceIncomeId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Debt source is required for repayment.',
          });
        }

        const debtSource = await prisma.income.findFirst({
          where: {
            id: input.debtSourceIncomeId,
            tenantId: ctx.tenantId,
            type: 'new_sale',
            remainingDebtAmount: { gt: 0 },
          },
          select: {
            id: true,
            customerId: true,
            courseId: true,
            tariffId: true,
            remainingDebtAmount: true,
          },
        });

        if (!debtSource) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected debt source not found.' });
        }

        if (debtSource.customerId !== customer.id) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Selected debt does not belong to the selected customer.',
          });
        }

        if (input.paymentAmount <= 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Repayment amount must be greater than zero.',
          });
        }

        if (input.paymentAmount > debtSource.remainingDebtAmount) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Repayment amount cannot exceed the selected debt.',
          });
        }

        const remainingDebtAmount = Math.max(debtSource.remainingDebtAmount - input.paymentAmount, 0);
        createdIncome = await prisma.$transaction(async (tx) => {
          const repayment = await tx.income.create({
            data: {
              tenantId: ctx.tenantId,
              customerId: customer!.id,
              managerUserId: input.managerUserId,
              type: 'repayment',
              relatedDebtIncomeId: debtSource.id,
              courseId: debtSource.courseId,
              tariffId: debtSource.tariffId,
              entryDate,
              deadline,
              debtAmount: debtSource.remainingDebtAmount,
              paymentAmount: input.paymentAmount,
              remainingDebtAmount,
            },
          });

          await tx.income.update({
            where: { id: debtSource.id },
            data: {
              remainingDebtAmount,
            },
          });

          return repayment;
        });
      }

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_create',
          resource: 'income',
          resourceId: createdIncome.id,
          metadata: {
            type: input.type,
            customerNumber: customer.customerNumber,
          },
        },
      });

      return createdIncome;
    }),

  listIncomes: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(200).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      return prisma.income.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { createdAt: 'desc' },
        take: input?.limit ?? 30,
        include: {
          customer: {
            select: {
              customerNumber: true,
              name: true,
            },
          },
          manager: {
            select: {
              name: true,
              username: true,
            },
          },
          course: {
            select: { name: true },
          },
          tariff: {
            select: { name: true },
          },
          relatedDebtIncome: {
            select: { id: true },
          },
        },
      });
    }),
});
