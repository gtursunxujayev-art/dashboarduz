import { normalizeDigits, sanitizeTelegramUsername } from '@dashboarduz/shared';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { isForeignKeyViolation } from '../../../lib/prisma-errors';
import { fetchCoursesWithTariffsSafe, toCourseOptions } from '../../../services/customer-income/catalog';
import { CUSTOMER_NUMBER_REGEX, TELEGRAM_USERNAME_REGEX } from '../../../services/customer-income/constants';
import { INCOME_LIFECYCLE_ACTIVE } from '../../../services/income-chain';
import { adminProcedure } from '../../trpc';

/** A typed customer number (digits only, after normalising) and name (non-empty), trimmed; BAD_REQUEST otherwise. */
function normalizeCustomerIdentity(rawCustomerNumber: string, rawName: string): { customerNumber: string; name: string } {
  const customerNumber = normalizeDigits(rawCustomerNumber.trim());

  if (!customerNumber || !CUSTOMER_NUMBER_REGEX.test(customerNumber)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Customer number must contain only digits.',
    });
  }

  const name = rawName.trim();

  if (!name) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Customer name is required.',
    });
  }

  return { customerNumber, name };
}

/** Why a customer was left in place by `deleteCustomers`: it still has money rows. */
type DeleteCustomerSkip = { id: string; reason: 'has_incomes' | 'has_adjustment_requests' };

export const customerProcedures = {
  customerEditorOptions: adminProcedure.query(async ({ ctx }) => {
    const courses = await fetchCoursesWithTariffsSafe({
      tenantId: ctx.tenantId,
      onlyActive: true,
      db: ctx.db,
    });

    return toCourseOptions(courses, { activeSubTariffsOnly: true });
  }),
  createCustomerOnly: adminProcedure
    .input(
      z.object({
        customerNumber: z.string().min(1).max(64),
        name: z.string().min(1).max(160),
        telegramUsername: z.string().max(160).optional(),
        courseId: z.string().uuid().optional(),
        tariffId: z.string().uuid().optional(),
        subTariffId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { customerNumber, name } = normalizeCustomerIdentity(input.customerNumber, input.name);

      const normalizedTelegramUsername = input.telegramUsername
        ? sanitizeTelegramUsername(input.telegramUsername.trim())
        : null;

      if (normalizedTelegramUsername && !TELEGRAM_USERNAME_REGEX.test(normalizedTelegramUsername)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Telegram username may contain only letters, digits, "_" and optional "@".',
        });
      }

      if (!input.courseId && (input.tariffId || input.subTariffId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Course is required when selecting tariff or sub-tariff.',
        });
      }
      if (!input.tariffId && input.subTariffId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Tariff is required when selecting sub-tariff.',
        });
      }

      const existing = await ctx.db.customer.findUnique({
        where: {
          tenantId_customerNumber: {
            tenantId: ctx.tenantId,
            customerNumber,
          },
        },
        select: { id: true },
      });

      if (existing) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Customer with this number already exists.',
        });
      }

      if (input.courseId) {
        const course = await ctx.db.course.findFirst({
          where: { id: input.courseId, tenantId: ctx.tenantId, isActive: true },
          select: { id: true },
        });

        if (!course) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected course not found.' });
        }
      }
      if (input.tariffId && input.courseId) {
        const tariff = await ctx.db.tariff.findFirst({
          where: {
            id: input.tariffId,
            tenantId: ctx.tenantId,
            courseId: input.courseId,
            isActive: true,
          },
          select: { id: true },
        });

        if (!tariff) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected tariff not found for course.' });
        }
      }
      if (input.subTariffId && input.tariffId) {
        const subTariff = await ctx.db.subTariff.findFirst({
          where: {
            id: input.subTariffId,
            tenantId: ctx.tenantId,
            tariffId: input.tariffId,
            isActive: true,
          },
          select: { id: true },
        });

        if (!subTariff) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected sub-tariff not found for tariff.' });
        }
      }

      const created = await ctx.db.customer.create({
        data: {
          tenantId: ctx.tenantId,
          customerNumber,
          name,
          telegramUsername: normalizedTelegramUsername || null,
          profileCourseId: input.courseId || null,
          profileTariffId: input.tariffId || null,
          profileSubTariffId: input.subTariffId || null,
        },
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'customer_create_only',
          resource: 'customer',
          resourceId: created.id,
          metadata: {
            customerNumber: created.customerNumber,
          },
        },
      });

      return created;
    }),
  updateCustomerIdentity: adminProcedure
    .input(
      z.object({
        customerId: z.string().uuid(),
        customerNumber: z.string().min(1).max(64),
        name: z.string().min(1).max(160),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { customerNumber, name } = normalizeCustomerIdentity(input.customerNumber, input.name);

      const current = await ctx.db.customer.findFirst({
        where: {
          tenantId: ctx.tenantId,
          id: input.customerId,
        },
        select: {
          id: true,
          customerNumber: true,
          name: true,
        },
      });

      if (!current) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Customer not found.',
        });
      }

      const duplicate = await ctx.db.customer.findFirst({
        where: {
          tenantId: ctx.tenantId,
          customerNumber,
          id: { not: current.id },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Another customer with this number already exists.',
        });
      }

      const updated = await ctx.db.customer.update({
        where: { id: current.id },
        data: {
          customerNumber,
          name,
        },
        select: {
          id: true,
          customerNumber: true,
          name: true,
        },
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'customer_identity_update',
          resource: 'customer',
          resourceId: updated.id,
          metadata: {
            previousCustomerNumber: current.customerNumber,
            previousName: current.name,
            customerNumber: updated.customerNumber,
            name: updated.name,
          },
        },
      });

      return updated;
    }),
  updateCustomersCourseAssignment: adminProcedure
    .input(
      z.object({
        customerIds: z.array(z.string().uuid()).min(1).max(500),
        courseId: z.string().uuid().nullable().optional(),
        tariffId: z.string().uuid().nullable().optional(),
        subTariffId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const customerIds = Array.from(new Set(input.customerIds));
      const courseId = input.courseId || null;
      const tariffId = input.tariffId || null;
      const subTariffId = input.subTariffId || null;

      if (!courseId && (tariffId || subTariffId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Course is required when selecting tariff or sub-tariff.',
        });
      }
      if (!tariffId && subTariffId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Tariff is required when selecting sub-tariff.',
        });
      }

      if (courseId) {
        const course = await ctx.db.course.findFirst({
          where: { id: courseId, tenantId: ctx.tenantId, isActive: true },
          select: { id: true },
        });

        if (!course) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected course not found.' });
        }
      }
      if (courseId && tariffId) {
        const tariff = await ctx.db.tariff.findFirst({
          where: { id: tariffId, tenantId: ctx.tenantId, courseId, isActive: true },
          select: { id: true },
        });

        if (!tariff) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected tariff not found for course.' });
        }
      }
      if (tariffId && subTariffId) {
        const subTariff = await ctx.db.subTariff.findFirst({
          where: { id: subTariffId, tenantId: ctx.tenantId, tariffId, isActive: true },
          select: { id: true },
        });

        if (!subTariff) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected sub-tariff not found for tariff.' });
        }
      }

      const updateResult = await ctx.db.$transaction(async (tx: Prisma.TransactionClient) => {
        const customerUpdate = await tx.customer.updateMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: customerIds },
          },
          data: {
            profileCourseId: courseId,
            profileTariffId: tariffId,
            profileSubTariffId: subTariffId,
          },
        });

        let updatedSalesCount = 0;
        let updatedRepaymentsCount = 0;

        // Kurs/tarif tanlanganda mos aktiv income zanjiri metadata ham yangilanadi.
        // Bu yerda payment/course price/debt summalari o'zgarmaydi.
        if (courseId) {
          const activeSales = await tx.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              customerId: { in: customerIds },
              type: 'new_sale',
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            },
            select: { id: true },
          });

          const saleIds = activeSales.map((sale) => sale.id);

          if (saleIds.length > 0) {
            const salesUpdate = await tx.income.updateMany({
              where: {
                tenantId: ctx.tenantId,
                id: { in: saleIds },
              },
              data: {
                courseId,
                tariffId,
              },
            });

            updatedSalesCount = salesUpdate.count;

            const repaymentsUpdate = await tx.income.updateMany({
              where: {
                tenantId: ctx.tenantId,
                type: 'repayment',
                relatedDebtIncomeId: { in: saleIds },
                lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              },
              data: {
                courseId,
                tariffId,
              },
            });

            updatedRepaymentsCount = repaymentsUpdate.count;
          }
        }

        return {
          customerUpdatedCount: customerUpdate.count,
          updatedSalesCount,
          updatedRepaymentsCount,
        };
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'customer_bulk_course_assignment_update',
          resource: 'customer',
          metadata: {
            customerCount: customerIds.length,
            updatedCount: updateResult.customerUpdatedCount,
            courseId,
            tariffId,
            subTariffId,
            updatedSalesCount: updateResult.updatedSalesCount,
            updatedRepaymentsCount: updateResult.updatedRepaymentsCount,
          },
        },
      });

      return {
        updatedCount: updateResult.customerUpdatedCount,
        updatedSalesCount: updateResult.updatedSalesCount,
        updatedRepaymentsCount: updateResult.updatedRepaymentsCount,
      };
    }),
  /**
   * Deletes customers that have no money rows. A customer with incomes or adjustment requests is never deleted (the
   * database refuses it too); its id comes back in `skipped` with the reason, so the page can say why. The check,
   * the delete and the audit row run in one transaction; a sale created for one of these customers in the meantime
   * makes the database refuse the delete, which is reported as a conflict to retry.
   */
  deleteCustomers: adminProcedure
    .input(
      z.object({
        customerIds: z.array(z.string().uuid()).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const customerIds = Array.from(new Set(input.customerIds));

      try {
        return await ctx.db.$transaction(async (tx) => {
          const customers = await tx.customer.findMany({
            where: { tenantId: ctx.tenantId, id: { in: customerIds } },
            select: { id: true },
          });
          const existingIds = customers.map((customer) => customer.id);

          if (!existingIds.length) {
            return { deletedCount: 0, deletedIds: [] as string[], skipped: [] as DeleteCustomerSkip[] };
          }

          const [incomeOwners, requestOwners] = await Promise.all([
            tx.income.groupBy({ by: ['customerId'], where: { tenantId: ctx.tenantId, customerId: { in: existingIds } } }),
            tx.incomeAdjustmentRequest.groupBy({ by: ['customerId'], where: { tenantId: ctx.tenantId, customerId: { in: existingIds } } }),
          ]);
          const withIncomes = new Set(incomeOwners.map((row) => row.customerId));
          const withRequests = new Set(requestOwners.map((row) => row.customerId));
          const skipped: DeleteCustomerSkip[] = existingIds
            .filter((id) => withIncomes.has(id) || withRequests.has(id))
            .map((id) => ({ id, reason: withIncomes.has(id) ? 'has_incomes' : 'has_adjustment_requests' }));
          const skippedIds = new Set(skipped.map((skip) => skip.id));
          const deletableIds = existingIds.filter((id) => !skippedIds.has(id));
          const deleteResult = deletableIds.length
            ? await tx.customer.deleteMany({ where: { tenantId: ctx.tenantId, id: { in: deletableIds } } })
            : { count: 0 };

          await tx.auditLog.create({
            data: {
              tenantId: ctx.tenantId,
              userId: ctx.user.userId,
              action: 'customer_bulk_delete',
              resource: 'customer',
              metadata: {
                deletedCount: deleteResult.count,
                requestedCount: customerIds.length,
                deletedIds: deletableIds,
                skipped,
              },
            },
          });

          return { deletedCount: deleteResult.count, deletedIds: deletableIds, skipped };
        });
      } catch (error: unknown) {
        if (isForeignKeyViolation(error)) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A sale or request was just added for one of these customers. Refresh and try again.',
          });
        }
        throw error;
      }
    }),
};
