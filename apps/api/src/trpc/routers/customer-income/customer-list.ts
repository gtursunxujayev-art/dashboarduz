import { debtFilterSchema } from '@dashboarduz/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { fetchCourseOptionsSafe, fetchCoursesWithTariffsSafe, toCourseOptions } from '../../../services/customer-income/catalog';
import { resolveIncomeScope } from '../../../services/customer-income/scope';
import { buildActiveSaleChainMetrics, extractSaleSubTariffId, getSaleAgreementAmount, INCOME_LIFECYCLE_ACTIVE, type SaleChainSaleRow } from '../../../services/income-chain';
import { protectedProcedure } from '../../trpc';

export const customerListProcedures = {
  listCustomers: protectedProcedure
    .input(
      z
        .object({
          query: z.string().optional(),
          courseId: z.string().uuid().optional(),
          tariffId: z.string().uuid().optional(),
          subTariffId: z.string().uuid().optional(),
          debtFilter: debtFilterSchema.default('all'),
          // Omitted = every matching customer; the page and its export need the full filtered list.
          limit: z.number().int().positive().max(10000).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      // Agents see their own rows, team leaders / OnlineAdmin their group, everyone else all rows.
      const scopedManagerUserIds = (await resolveIncomeScope(ctx)).userIds;
      const trimmedQuery = input?.query?.trim();
      const andConditions: Prisma.CustomerWhereInput[] = [];

      if (scopedManagerUserIds) {
        andConditions.push({
          incomes: {
            some: {
              managerUserId: { in: scopedManagerUserIds },
            },
          },
        });
      }

      if (trimmedQuery) {
        andConditions.push({
          OR: [
            { customerNumber: { contains: trimmedQuery, mode: 'insensitive' } },
            { name: { contains: trimmedQuery, mode: 'insensitive' } },
            { telegramUsername: { contains: trimmedQuery, mode: 'insensitive' } },
          ],
        });
      }

      if (input?.courseId || input?.tariffId) {
        andConditions.push({
          incomes: {
            some: {
              type: 'new_sale',
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              ...(scopedManagerUserIds
                ? {
                    managerUserId: { in: scopedManagerUserIds },
                  }
                : {}),
              ...(input?.courseId
                ? {
                    courseId: input.courseId,
                  }
                : {}),
              ...(input?.tariffId
                ? {
                    tariffId: input.tariffId,
                  }
                : {}),
            },
          },
        });
      }

      const where: Prisma.CustomerWhereInput = {
        tenantId: ctx.tenantId,
        ...(andConditions.length ? { AND: andConditions } : {}),
      };

      const [allMatchedCustomersLite, courseOptions, catalogCourses] = await Promise.all([
        ctx.db.customer.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            profileCourseId: true,
            profileTariffId: true,
            profileSubTariffId: true,
          },
        }),
        fetchCourseOptionsSafe(ctx.tenantId, ctx.db),
        fetchCoursesWithTariffsSafe({
          tenantId: ctx.tenantId,
          onlyActive: true,
          db: ctx.db,
        }),
      ]);

      if (!allMatchedCustomersLite.length) {
        return {
          customers: [],
          summaryCounts: {
            totalCustomers: 0,
            withDebtCustomers: 0,
            withoutDebtCustomers: 0,
          },
          courseOptions,
          catalogOptions: toCourseOptions(catalogCourses, { activeSubTariffsOnly: true }),
        };
      }

      const customerIds = allMatchedCustomersLite.map((customer) => customer.id);
      const profileCourseIds = Array.from(new Set(allMatchedCustomersLite.map((customer) => customer.profileCourseId).filter(Boolean))) as string[];
      const profileTariffIds = Array.from(new Set(allMatchedCustomersLite.map((customer) => customer.profileTariffId).filter(Boolean))) as string[];
      const profileSubTariffIds = Array.from(new Set(allMatchedCustomersLite.map((customer) => customer.profileSubTariffId).filter(Boolean))) as string[];
      const [profileCourses, profileTariffs, profileSubTariffs] = await Promise.all([
        profileCourseIds.length > 0
          ? ctx.db.course.findMany({
              where: { tenantId: ctx.tenantId, id: { in: profileCourseIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        profileTariffIds.length > 0
          ? ctx.db.tariff.findMany({
              where: { tenantId: ctx.tenantId, id: { in: profileTariffIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        profileSubTariffIds.length > 0
          ? ctx.db.subTariff.findMany({
              where: { tenantId: ctx.tenantId, id: { in: profileSubTariffIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
      ]);
      const profileCourseNameById = new Map(profileCourses.map((course) => [course.id, course.name]));
      const profileTariffNameById = new Map(profileTariffs.map((tariff) => [tariff.id, tariff.name]));
      const profileSubTariffNameById = new Map(profileSubTariffs.map((subTariff) => [subTariff.id, subTariff.name]));
      const customerProfileById = new Map(
        allMatchedCustomersLite.map((customer) => [
          customer.id,
          {
            profileCourseId: customer.profileCourseId || null,
            profileTariffId: customer.profileTariffId || null,
            profileSubTariffId: customer.profileSubTariffId || null,
          },
        ]),
      );
      const [relatedIncomes, activeSales] = await Promise.all([
        ctx.db.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            customerId: { in: customerIds },
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            ...(scopedManagerUserIds
              ? {
                  managerUserId: { in: scopedManagerUserIds },
                }
              : {}),
          },
          orderBy: { entryDate: 'desc' },
          select: {
            customerId: true,
            type: true,
            paymentAmount: true,
            remainingDebtAmount: true,
            entryDate: true,
            managerUserId: true,
            manager: {
              select: {
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
          },
        }),
        ctx.db.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            customerId: { in: customerIds },
            type: 'new_sale',
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            ...(scopedManagerUserIds
              ? {
                  managerUserId: { in: scopedManagerUserIds },
                }
              : {}),
          },
          orderBy: [{ entryDate: 'desc' }],
          select: {
            id: true,
            customerId: true,
            entryDate: true,
            remainingDebtAmount: true,
            coursePriceAmount: true,
            debtAmount: true,
            paymentAmount: true,
            legacyImportMeta: true,
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

      const saleSubTariffIds = Array.from(
        new Set(
          (activeSales as Array<{ legacyImportMeta: Prisma.JsonValue | null }>)
            .map((sale) => extractSaleSubTariffId(sale.legacyImportMeta))
            .filter((value): value is string => Boolean(value)),
        ),
      );
      const missingSaleSubTariffIds = saleSubTariffIds.filter((id) => !profileSubTariffNameById.has(id));

      if (missingSaleSubTariffIds.length > 0) {
        const additionalSubTariffs = await ctx.db.subTariff.findMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: missingSaleSubTariffIds },
          },
          select: { id: true, name: true },
        });

        for (const subTariff of additionalSubTariffs) {
          profileSubTariffNameById.set(subTariff.id, subTariff.name);
        }
      }

      const aggregatesByCustomer = new Map<
        string,
        {
          totalDebtAmount: number;
          totalPaidAmount: number;
          hasDebt: boolean;
          lastActivityAt: Date | null;
          courses: Set<string>;
          responsibleManagerUserId: string | null;
          responsibleManagerLabel: string | null;
        }
      >();
      const courseEntriesByCustomer = new Map<
        string,
        Array<{
          saleIncomeId: string;
          courseId: string | null;
          tariffId: string | null;
          subTariffId: string | null;
          courseName: string | null;
          tariffName: string | null;
          subTariffName: string | null;
          label: string;
          entryDate: string;
          remainingDebtAmount: number;
        }>
      >();
      const activeSaleChainMetricsBySaleId = await buildActiveSaleChainMetrics({
        tenantId: ctx.tenantId,
        sales: activeSales as SaleChainSaleRow[],
        db: ctx.db,
      });

      for (const sale of activeSales as Array<{
        id: string;
        customerId: string;
        entryDate: Date;
        remainingDebtAmount: number;
        coursePriceAmount: number | null;
        debtAmount: number | null;
        paymentAmount: number;
        legacyImportMeta: Prisma.JsonValue | null;
        course: { id: string; name: string } | null;
        tariff: { id: string; name: string } | null;
      }>) {
        const profile = customerProfileById.get(sale.customerId);
        const saleSubTariffId = extractSaleSubTariffId(sale.legacyImportMeta);
        const profileMatchedSubTariffId = profile
          && profile.profileCourseId === sale.course?.id
          && profile.profileTariffId === sale.tariff?.id
          ? profile.profileSubTariffId || null
          : null;
        const effectiveSubTariffId = saleSubTariffId || profileMatchedSubTariffId || null;
        const subTariffName = effectiveSubTariffId
          ? profileSubTariffNameById.get(effectiveSubTariffId) || null
          : null;
        const labelParts = [sale.course?.name || null, sale.tariff?.name || null, subTariffName].filter(Boolean);
        const label = labelParts.length ? labelParts.join(' / ') : "Noma'lum kurs";
        const list = courseEntriesByCustomer.get(sale.customerId) || [];

        list.push({
          saleIncomeId: sale.id,
          courseId: sale.course?.id || null,
          tariffId: sale.tariff?.id || null,
          subTariffId: effectiveSubTariffId,
          courseName: sale.course?.name || null,
          tariffName: sale.tariff?.name || null,
          subTariffName,
          label,
          entryDate: sale.entryDate.toISOString(),
          remainingDebtAmount: activeSaleChainMetricsBySaleId.get(sale.id)?.currentDebtAmount ?? (sale.remainingDebtAmount || 0),
        });
        courseEntriesByCustomer.set(sale.customerId, list);

        const current = aggregatesByCustomer.get(sale.customerId) || {
          totalDebtAmount: 0,
          totalPaidAmount: 0,
          hasDebt: false,
          lastActivityAt: null as Date | null,
          courses: new Set<string>(),
          responsibleManagerUserId: null as string | null,
          responsibleManagerLabel: null as string | null,
        };
        const saleMetric = activeSaleChainMetricsBySaleId.get(sale.id);
        const saleDebt = saleMetric?.currentDebtAmount ?? (sale.remainingDebtAmount || 0);
        const salePaid = saleMetric?.paidAmount ?? Number(sale.paymentAmount || 0);
        // Totals cover only the sales the list is filtered to, and never technical (agreement == 1) sales.
        const matchesCourseFilter = (!input?.courseId || sale.course?.id === input.courseId)
          && (!input?.tariffId || sale.tariff?.id === input.tariffId);
        const isTechnicalSale = getSaleAgreementAmount(sale) === 1;

        if (matchesCourseFilter && !isTechnicalSale) {
          current.totalDebtAmount += saleDebt;
          current.totalPaidAmount += salePaid;
          current.hasDebt = current.hasDebt || saleDebt > 0;
        }
        if (sale.course?.name) {
          current.courses.add(sale.course.name);
        }
        aggregatesByCustomer.set(sale.customerId, current);
      }

      for (const income of relatedIncomes as Array<{
        customerId: string;
        type: string;
        paymentAmount: number;
        remainingDebtAmount: number;
        entryDate: Date;
        managerUserId: string | null;
        manager: { name: string | null; username: string | null } | null;
        course: { id: string; name: string } | null;
      }>) {
        const current = aggregatesByCustomer.get(income.customerId) || {
          totalDebtAmount: 0,
          totalPaidAmount: 0,
          hasDebt: false,
          lastActivityAt: null as Date | null,
          courses: new Set<string>(),
          responsibleManagerUserId: null as string | null,
          responsibleManagerLabel: null as string | null,
        };

        if (!current.lastActivityAt || income.entryDate > current.lastActivityAt) {
          current.lastActivityAt = income.entryDate;
        }

        if (income.course?.name) {
          current.courses.add(income.course.name);
        }

        if (!current.responsibleManagerLabel) {
          current.responsibleManagerUserId = income.managerUserId || null;
          current.responsibleManagerLabel = income.manager?.name || income.manager?.username || income.managerUserId || null;
        }

        aggregatesByCustomer.set(income.customerId, current);
      }

      const allMatchedCustomerIds = new Set(customerIds);
      const customersAfterSubTariffFilterIds = input?.subTariffId
        ? new Set(
            customerIds.filter((customerId) => {
              const entries = courseEntriesByCustomer.get(customerId) || [];

              return entries.some((entry) =>
                entry.subTariffId === input.subTariffId
                && (!input.courseId || entry.courseId === input.courseId)
                && (!input.tariffId || entry.tariffId === input.tariffId));
            }),
          )
        : allMatchedCustomerIds;
      const customersAfterDebtFilterIds = new Set(
        Array.from(customersAfterSubTariffFilterIds).filter((customerId) => {
          if (!input?.debtFilter) {
            return true;
          }
          const aggregate = aggregatesByCustomer.get(customerId);
          const hasDebt = Boolean(aggregate?.hasDebt);

          if (input.debtFilter === 'with_debt') {
            return hasDebt;
          }
          if (input.debtFilter === 'without_debt') {
            return !hasDebt;
          }

          return true;
        }),
      );

      // Filter first, then limit: limiting before the debt/sub-tariff filter dropped most matching customers.
      const filteredCustomerIds = Array.from(customersAfterDebtFilterIds);
      const customersAfterDebtFilter = filteredCustomerIds.length > 0
        ? await ctx.db.customer.findMany({
            where: {
              tenantId: ctx.tenantId,
              id: { in: filteredCustomerIds },
            },
            orderBy: { createdAt: 'desc' },
            ...(input?.limit ? { take: input.limit } : {}),
            select: {
              id: true,
              customerNumber: true,
              name: true,
              telegramUsername: true,
              profileCourseId: true,
              profileTariffId: true,
              profileSubTariffId: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : [];

      return {
        customers: customersAfterDebtFilter.map((customer) => {
          const aggregate = aggregatesByCustomer.get(customer.id);
          const courseEntries = courseEntriesByCustomer.get(customer.id) || [];
          const profileCourseName = customer.profileCourseId ? profileCourseNameById.get(customer.profileCourseId) || null : null;
          const profileTariffName = customer.profileTariffId ? profileTariffNameById.get(customer.profileTariffId) || null : null;
          const profileSubTariffName = customer.profileSubTariffId ? profileSubTariffNameById.get(customer.profileSubTariffId) || null : null;
          const profileCourseLabel = [profileCourseName, profileTariffName, profileSubTariffName].filter(Boolean).join(' / ');
          const aggregateCoursesFromEntries = courseEntries.map((entry) => entry.label);
          const aggregateCourses = aggregateCoursesFromEntries.length
            ? aggregateCoursesFromEntries
            : (aggregate ? Array.from(aggregate.courses) : []);
          const mergedCourses = profileCourseLabel && !aggregateCourses.includes(profileCourseLabel)
            ? [profileCourseLabel, ...aggregateCourses]
            : aggregateCourses;

          return {
            ...customer,
            totalDebtAmount: aggregate?.totalDebtAmount ?? 0,
            totalPaidAmount: aggregate?.totalPaidAmount ?? 0,
            hasDebt: aggregate?.hasDebt ?? false,
            lastActivityAt: aggregate?.lastActivityAt ?? null,
            courses: mergedCourses,
            courseEntries,
            responsibleManagerUserId: aggregate?.responsibleManagerUserId ?? null,
            responsibleManagerLabel: aggregate?.responsibleManagerLabel ?? null,
            profileCourseName,
            profileTariffName,
            profileSubTariffName,
          };
        }),
        summaryCounts: {
          totalCustomers: customersAfterDebtFilterIds.size,
          withDebtCustomers: Array.from(customersAfterDebtFilterIds).reduce((count, customerId) => {
            return count + (aggregatesByCustomer.get(customerId)?.hasDebt ? 1 : 0);
          }, 0),
          withoutDebtCustomers: Array.from(customersAfterDebtFilterIds).reduce((count, customerId) => {
            return count + (aggregatesByCustomer.get(customerId)?.hasDebt ? 0 : 1);
          }, 0),
        },
        courseOptions,
        catalogOptions: toCourseOptions(catalogCourses, { activeSubTariffsOnly: true }),
      };
    }),
};
