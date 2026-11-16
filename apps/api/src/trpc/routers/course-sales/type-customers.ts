import { courseTypeCategorySchema, isAgentOnly } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { buildCustomerCoursesByCustomer, findSaleIdsBySubTariff } from '../../../services/course-sales/helpers';
import { buildActiveSaleChainMetrics, extractSaleSubTariffId, INCOME_LIFECYCLE_ACTIVE, type SaleChainSaleRow } from '../../../services/income-chain';
import { resolveSaleAgreementAmount } from '../../../services/income-facts';
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
      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : undefined;
      const query = input.query?.trim();
      const skip = (input.page - 1) * input.limit;

      const categoryCourses = await ctx.db.course.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          category: input.category,
        },
        select: { id: true },
      });
      const categoryCourseIds = categoryCourses.map((course) => course.id);

      if (categoryCourseIds.length === 0) {
        return {
          page: input.page,
          limit: input.limit,
          total: 0,
          totalPages: 1,
          rows: [],
        };
      }

      const scopedFilters: Record<string, unknown>[] = [];

      if (input.courseId) {
        if (!categoryCourseIds.includes(input.courseId)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: "Kurs tanlangan turga tegishli emas." });
        }
        scopedFilters.push({ courseId: input.courseId });
      } else {
        scopedFilters.push({ courseId: { in: categoryCourseIds } });
      }
      if (input.tariffId) {
        scopedFilters.push({ tariffId: input.tariffId });
      }
      if (input.subTariffId) {
        scopedFilters.push({
          id: { in: await findSaleIdsBySubTariff(ctx.tenantId, input.subTariffId, [...scopedFilters], ctx.db) },
        });
      }

      // 1 so'm (technical) sales stay in the customer lists; summaries count them separately as service exchange.

      const where = {
        tenantId: ctx.tenantId,
        type: 'new_sale',
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        ...(scopedManagerUserId ? { managerUserId: scopedManagerUserId } : {}),
        ...(scopedFilters.length ? { AND: scopedFilters } : {}),
        ...(query
          ? {
              OR: [
                { customer: { customerNumber: { contains: query, mode: 'insensitive' as const } } },
                { customer: { name: { contains: query, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      };

      const [total, sales] = await Promise.all([
        ctx.db.income.count({ where }),
        ctx.db.income.findMany({
          where,
          orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
          skip,
          take: input.limit,
          select: {
            id: true,
            customerId: true,
            entryDate: true,
            coursePriceAmount: true,
            debtAmount: true,
            paymentAmount: true,
            remainingDebtAmount: true,
            customer: {
              select: {
                customerNumber: true,
                name: true,
                telegramUsername: true,
                profileCourseId: true,
                profileTariffId: true,
                profileSubTariffId: true,
              },
            },
            legacyImportMeta: true,
            manager: {
              select: {
                id: true,
                name: true,
                username: true,
              },
            },
            course: {
              select: {
                id: true,
                name: true,
              },
            },
            tariff: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),
      ]);

      const customerIds = Array.from(new Set(sales.map((sale) => sale.customerId)));
      const profileSubTariffIds = Array.from(
        new Set(
          sales
            .map((sale) => sale.customer.profileSubTariffId)
            .filter((value): value is string => Boolean(value)),
        ),
      );
      const saleSubTariffIds = Array.from(
        new Set(
          sales
            .map((sale) => extractSaleSubTariffId(sale.legacyImportMeta))
            .filter((value): value is string => Boolean(value)),
        ),
      );
      const combinedSubTariffIds = Array.from(new Set([...profileSubTariffIds, ...saleSubTariffIds]));
      const profileCourseIds = Array.from(
        new Set(
          sales
            .map((sale) => sale.customer.profileCourseId)
            .filter((value): value is string => Boolean(value)),
        ),
      );
      const profileTariffIds = Array.from(
        new Set(
          sales
            .map((sale) => sale.customer.profileTariffId)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      const [subTariffs, profileCourses, profileTariffs, allActiveSalesByCustomer] = await Promise.all([
        combinedSubTariffIds.length > 0
          ? ctx.db.subTariff.findMany({
              where: {
                tenantId: ctx.tenantId,
                id: { in: combinedSubTariffIds },
              },
              select: {
                id: true,
                name: true,
              },
            })
          : Promise.resolve([]),
        profileCourseIds.length > 0
          ? ctx.db.course.findMany({
              where: {
                tenantId: ctx.tenantId,
                id: { in: profileCourseIds },
              },
              select: {
                id: true,
                name: true,
              },
            })
          : Promise.resolve([]),
        profileTariffIds.length > 0
          ? ctx.db.tariff.findMany({
              where: {
                tenantId: ctx.tenantId,
                id: { in: profileTariffIds },
              },
              select: {
                id: true,
                name: true,
              },
            })
          : Promise.resolve([]),
        customerIds.length > 0
          ? ctx.db.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                customerId: { in: customerIds },
                type: 'new_sale',
                lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
                ...(scopedManagerUserId ? { managerUserId: scopedManagerUserId } : {}),
              },
              select: {
                id: true,
                customerId: true,
                entryDate: true,
                remainingDebtAmount: true,
                coursePriceAmount: true,
                debtAmount: true,
                paymentAmount: true,
                course: {
                  select: { id: true, name: true },
                },
                tariff: {
                  select: { id: true, name: true },
                },
                legacyImportMeta: true,
                customer: {
                  select: {
                    profileCourseId: true,
                    profileTariffId: true,
                    profileSubTariffId: true,
                  },
                },
              },
            })
          : Promise.resolve([]),
      ]);

      const subTariffNameById = new Map(subTariffs.map((subTariff) => [subTariff.id, subTariff.name]));
      const profileCourseNameById = new Map(profileCourses.map((course) => [course.id, course.name]));
      const profileTariffNameById = new Map(profileTariffs.map((tariff) => [tariff.id, tariff.name]));
      const chainMetricsBySaleId = await buildActiveSaleChainMetrics({
        tenantId: ctx.tenantId,
        sales: sales,
        db: ctx.db,
      });
      const allCustomerChainMetricsBySaleId = await buildActiveSaleChainMetrics({
        tenantId: ctx.tenantId,
        sales: allActiveSalesByCustomer as SaleChainSaleRow[],
        db: ctx.db,
      });
      const customerCoursesByCustomer = buildCustomerCoursesByCustomer(
        allActiveSalesByCustomer as Array<{
          id: string;
          customerId: string;
          entryDate: Date;
          remainingDebtAmount: number;
          legacyImportMeta: unknown;
          course: { id: string; name: string } | null;
          tariff: { id: string; name: string } | null;
          customer: {
            profileCourseId: string | null;
            profileTariffId: string | null;
            profileSubTariffId: string | null;
          };
        }>,
        subTariffNameById,
        allCustomerChainMetricsBySaleId,
      );

      return {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / input.limit)),
        rows: sales.map((sale) => {
          const metric = chainMetricsBySaleId.get(sale.id);
          const paidAmount = metric?.paidAmount ?? (sale.paymentAmount ?? 0);
          const debtAmount = metric?.currentDebtAmount ?? (sale.remainingDebtAmount ?? 0);
          const agreementAmount = metric?.agreementAmount ?? resolveSaleAgreementAmount(sale);
          const lastActivityAt = metric?.lastActivityAt ?? sale.entryDate;
          const managerLabel = sale.manager.name || sale.manager.username || sale.manager.id;
          const profileCourseName = sale.customer.profileCourseId
            ? profileCourseNameById.get(sale.customer.profileCourseId) || null
            : null;
          const profileTariffName = sale.customer.profileTariffId
            ? profileTariffNameById.get(sale.customer.profileTariffId) || null
            : null;
          const profileSubTariffName = sale.customer.profileSubTariffId
            ? subTariffNameById.get(sale.customer.profileSubTariffId) || null
            : null;
          const saleSubTariffId = extractSaleSubTariffId(sale.legacyImportMeta);
          const resolvedSubTariffName = saleSubTariffId
            ? subTariffNameById.get(saleSubTariffId) || null
            : profileSubTariffName;

          return {
            saleId: sale.id,
            customerId: sale.customerId,
            customerNumber: sale.customer.customerNumber,
            customerName: sale.customer.name,
            telegramUsername: sale.customer.telegramUsername || null,
            managerUserId: sale.manager.id,
            managerLabel,
            profileCourseId: sale.customer.profileCourseId || null,
            profileTariffId: sale.customer.profileTariffId || null,
            profileSubTariffId: sale.customer.profileSubTariffId || null,
            courseName: sale.course?.name || profileCourseName || null,
            tariffName: sale.tariff?.name || profileTariffName || null,
            subTariffName: resolvedSubTariffName,
            agreementAmount,
            paidAmount,
            debtAmount,
            entryDate: sale.entryDate.toISOString(),
            lastActivityAt: lastActivityAt.toISOString(),
            customerCourses: customerCoursesByCustomer.get(sale.customerId) || [],
          };
        }),
      };
    }),
};
