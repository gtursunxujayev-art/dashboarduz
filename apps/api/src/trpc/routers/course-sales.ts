import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { protectedProcedure, router } from '../trpc';

const courseSalesRangeSchema = z.enum(['today', 'week', 'month', 'custom']);
const courseSalesTypeCategorySchema = z.enum(['online', 'offline', 'intensive']);
const REPORT_TZ_OFFSET_MINUTES = 5 * 60; // GMT+5
const INCOME_LIFECYCLE_ACTIVE = 'active';
const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'Finance']);

type CourseSalesRange = z.infer<typeof courseSalesRangeSchema>;

function isAgentOnly(roles: string[]): boolean {
  return roles.includes('Agent') && !roles.some((role) => PRIVILEGED_ROLES.has(role));
}

function parseCustomDate(input: string, endOfDay: boolean): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: "Sana formati YYYY-MM-DD bo'lishi kerak." });
  }

  const timestamp = `${input}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}+05:00`;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Noto'g'ri sana: ${input}` });
  }
  return parsed;
}

function getRangeStart(range: CourseSalesRange, now: Date): Date {
  const offsetMs = REPORT_TZ_OFFSET_MINUTES * 60 * 1000;
  const shiftedNow = new Date(now.getTime() + offsetMs);
  const year = shiftedNow.getUTCFullYear();
  const month = shiftedNow.getUTCMonth();
  const date = shiftedNow.getUTCDate();

  if (range === 'today') {
    return new Date(Date.UTC(year, month, date) - offsetMs);
  }

  if (range === 'week') {
    const day = shiftedNow.getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    return new Date(Date.UTC(year, month, date - daysSinceMonday) - offsetMs);
  }

  return new Date(Date.UTC(year, month, 1) - offsetMs);
}

function resolveDateRange(range: CourseSalesRange, now: Date, dateFrom?: string, dateTo?: string) {
  if (range !== 'custom') {
    return { rangeStart: getRangeStart(range, now), rangeEnd: now };
  }

  if (!dateFrom || !dateTo) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: "Ixtiyoriy davr uchun 'dan' va 'gacha' sanalari majburiy.",
    });
  }

  const rangeStart = parseCustomDate(dateFrom, false);
  const rangeEnd = parseCustomDate(dateTo, true);

  if (rangeEnd < rangeStart) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: "'gacha' sanasi 'dan' sanasidan oldin bo'lishi mumkin emas.",
    });
  }

  return { rangeStart, rangeEnd };
}

function normalizeSubTariffName(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function buildCategoryLabel(category: string): string {
  const key = String(category || '').trim().toLowerCase();
  if (key === 'online') return 'Online';
  if (key === 'offline') return 'Offline';
  if (key === 'intensive') return 'Intensiv';
  if (key === 'additional_service') return "Qo'shimcha xizmat";
  return "Noma'lum";
}

type CustomerCourseEntry = {
  saleIncomeId: string;
  courseName: string | null;
  tariffName: string | null;
  label: string;
  entryDate: string;
  remainingDebtAmount: number;
};

function buildCustomerCoursesByCustomer(
  activeSales: Array<{
    id: string;
    customerId: string;
    entryDate: Date;
    remainingDebtAmount: number;
    course: { name: string } | null;
    tariff: { name: string } | null;
  }>,
): Map<string, CustomerCourseEntry[]> {
  const map = new Map<string, CustomerCourseEntry[]>();
  for (const sale of activeSales) {
    const labelParts = [sale.course?.name || null, sale.tariff?.name || null].filter(Boolean);
    const label = labelParts.length ? labelParts.join(' / ') : "Noma'lum kurs";
    const rows = map.get(sale.customerId) || [];
    rows.push({
      saleIncomeId: sale.id,
      courseName: sale.course?.name || null,
      tariffName: sale.tariff?.name || null,
      label,
      entryDate: sale.entryDate.toISOString(),
      remainingDebtAmount: sale.remainingDebtAmount || 0,
    });
    map.set(sale.customerId, rows);
  }

  for (const [customerId, rows] of map.entries()) {
    rows.sort((a, b) => b.entryDate.localeCompare(a.entryDate));
    map.set(customerId, rows);
  }

  return map;
}

export const courseSalesRouter = router({
  options: protectedProcedure.query(async ({ ctx }) => {
    const courses = await prisma.course.findMany({
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
        category: courseSalesTypeCategorySchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const courses = await prisma.course.findMany({
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

  typeSummary: protectedProcedure
    .input(
      z.object({
        category: courseSalesTypeCategorySchema,
        courseId: z.string().uuid().optional(),
        tariffId: z.string().uuid().optional(),
        subTariffId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : undefined;
      const categoryCourses = await prisma.course.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          category: input.category,
        },
        select: { id: true, name: true },
      });
      const categoryCourseIds = categoryCourses.map((course) => course.id);
      if (categoryCourseIds.length === 0) {
        return {
          category: input.category,
          categoryLabel: buildCategoryLabel(input.category),
          selectedCourseId: input.courseId || null,
          selectedTariffId: input.tariffId || null,
          selectedSubTariffId: input.subTariffId || null,
          totals: {
            soldCount: 0,
            fullyPaidCount: 0,
            debtorsCount: 0,
            agreementAmount: 0,
            paidAmount: 0,
            remainingDebtAmount: 0,
            customerCount: 0,
          },
          updatedAt: new Date().toISOString(),
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
          customer: { profileSubTariffId: input.subTariffId },
        });
      }

      const matchedSales = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          ...(scopedManagerUserId ? { managerUserId: scopedManagerUserId } : {}),
          ...(scopedFilters.length ? { AND: scopedFilters } : {}),
        },
        select: {
          id: true,
          customerId: true,
          coursePriceAmount: true,
          paymentAmount: true,
          remainingDebtAmount: true,
        },
      });

      const saleIds = matchedSales.map((sale) => sale.id);
      const saleIdSet = new Set(saleIds);
      const paidBySaleId = new Map<string, number>();
      if (saleIds.length > 0) {
        const paidIncomes = await prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            OR: [
              { id: { in: saleIds } },
              { relatedDebtIncomeId: { in: saleIds } },
            ],
          },
          select: {
            id: true,
            relatedDebtIncomeId: true,
            paymentAmount: true,
          },
        });
        for (const income of paidIncomes) {
          const saleId = income.relatedDebtIncomeId || income.id;
          if (!saleIdSet.has(saleId)) {
            continue;
          }
          paidBySaleId.set(saleId, (paidBySaleId.get(saleId) ?? 0) + (income.paymentAmount ?? 0));
        }
      }

      let agreementAmount = 0;
      let remainingDebtAmount = 0;
      let fullyPaidCount = 0;
      let debtorsCount = 0;
      for (const sale of matchedSales) {
        agreementAmount += sale.coursePriceAmount ?? sale.paymentAmount ?? 0;
        const debt = sale.remainingDebtAmount ?? 0;
        remainingDebtAmount += debt;
        if (debt <= 0) {
          fullyPaidCount += 1;
        } else {
          debtorsCount += 1;
        }
      }
      const paidAmount = Array.from(paidBySaleId.values()).reduce((sum, value) => sum + value, 0);

      return {
        category: input.category,
        categoryLabel: buildCategoryLabel(input.category),
        selectedCourseId: input.courseId || null,
        selectedTariffId: input.tariffId || null,
        selectedSubTariffId: input.subTariffId || null,
        totals: {
          soldCount: matchedSales.length,
          fullyPaidCount,
          debtorsCount,
          agreementAmount,
          paidAmount,
          remainingDebtAmount,
          customerCount: new Set(matchedSales.map((sale) => sale.customerId)).size,
        },
        updatedAt: new Date().toISOString(),
      };
    }),

  typeCustomers: protectedProcedure
    .input(
      z.object({
        category: courseSalesTypeCategorySchema,
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

      const categoryCourses = await prisma.course.findMany({
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
          customer: { profileSubTariffId: input.subTariffId },
        });
      }

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
        prisma.income.count({ where }),
        prisma.income.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }],
          skip,
          take: input.limit,
          select: {
            id: true,
            customerId: true,
            entryDate: true,
            coursePriceAmount: true,
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

      const saleIds = sales.map((sale) => sale.id);
      const customerIds = Array.from(new Set(sales.map((sale) => sale.customerId)));
      const profileSubTariffIds = Array.from(
        new Set(
          sales
            .map((sale) => sale.customer.profileSubTariffId)
            .filter((value): value is string => Boolean(value)),
        ),
      );
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

      const [incomes, subTariffs, profileCourses, profileTariffs, allActiveSalesByCustomer] = await Promise.all([
        saleIds.length > 0
          ? prisma.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
                OR: [
                  { id: { in: saleIds } },
                  { relatedDebtIncomeId: { in: saleIds } },
                ],
              },
              select: {
                id: true,
                relatedDebtIncomeId: true,
                paymentAmount: true,
                entryDate: true,
              },
            })
          : Promise.resolve([]),
        profileSubTariffIds.length > 0
          ? prisma.subTariff.findMany({
              where: {
                tenantId: ctx.tenantId,
                id: { in: profileSubTariffIds },
              },
              select: {
                id: true,
                name: true,
              },
            })
          : Promise.resolve([]),
        profileCourseIds.length > 0
          ? prisma.course.findMany({
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
          ? prisma.tariff.findMany({
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
          ? prisma.income.findMany({
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
                course: {
                  select: { name: true },
                },
                tariff: {
                  select: { name: true },
                },
              },
            })
          : Promise.resolve([]),
      ]);

      const subTariffNameById = new Map(subTariffs.map((subTariff) => [subTariff.id, subTariff.name]));
      const profileCourseNameById = new Map(profileCourses.map((course) => [course.id, course.name]));
      const profileTariffNameById = new Map(profileTariffs.map((tariff) => [tariff.id, tariff.name]));
      const customerCoursesByCustomer = buildCustomerCoursesByCustomer(
        allActiveSalesByCustomer as Array<{
          id: string;
          customerId: string;
          entryDate: Date;
          remainingDebtAmount: number;
          course: { name: string } | null;
          tariff: { name: string } | null;
        }>,
      );
      const paidBySaleId = new Map<string, number>();
      const lastActivityBySaleId = new Map<string, Date>();
      const saleIdSet = new Set(saleIds);

      for (const income of incomes) {
        const saleId = income.relatedDebtIncomeId || income.id;
        if (!saleIdSet.has(saleId)) {
          continue;
        }
        paidBySaleId.set(saleId, (paidBySaleId.get(saleId) ?? 0) + (income.paymentAmount ?? 0));
        const currentLast = lastActivityBySaleId.get(saleId);
        if (!currentLast || income.entryDate > currentLast) {
          lastActivityBySaleId.set(saleId, income.entryDate);
        }
      }

      return {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / input.limit)),
        rows: sales.map((sale) => {
          const paidAmount = paidBySaleId.get(sale.id) ?? (sale.paymentAmount ?? 0);
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
          return {
            saleId: sale.id,
            customerId: sale.customerId,
            customerNumber: sale.customer.customerNumber,
            customerName: sale.customer.name,
            telegramUsername: sale.customer.telegramUsername || null,
            managerUserId: sale.manager.id,
            managerLabel,
            courseName: sale.course?.name || profileCourseName || null,
            tariffName: sale.tariff?.name || profileTariffName || null,
            subTariffName: profileSubTariffName,
            agreementAmount: sale.coursePriceAmount ?? sale.paymentAmount ?? 0,
            paidAmount,
            debtAmount: sale.remainingDebtAmount ?? 0,
            entryDate: sale.entryDate.toISOString(),
            lastActivityAt: (lastActivityBySaleId.get(sale.id) || sale.entryDate).toISOString(),
            customerCourses: customerCoursesByCustomer.get(sale.customerId) || [],
          };
        }),
      };
    }),

  summary: protectedProcedure
    .input(
      z.object({
        courseId: z.string().uuid(),
        tariffId: z.string().uuid().optional(),
        subTariffId: z.string().uuid().optional(),
        range: courseSalesRangeSchema,
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : undefined;
      const scopedFilters: Record<string, unknown>[] = [];
      if (input.courseId) {
        scopedFilters.push({ courseId: input.courseId });
      }
      if (input.tariffId) {
        scopedFilters.push({ tariffId: input.tariffId });
      }
      if (input.subTariffId) {
        scopedFilters.push({
          customer: { profileSubTariffId: input.subTariffId },
        });
      }

      const [course, matchedSales, profileSubTariffs] = await Promise.all([
        prisma.course.findFirst({
          where: {
            tenantId: ctx.tenantId,
            id: input.courseId,
            isActive: true,
          },
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
        }),
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'new_sale',
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            ...(scopedManagerUserId ? { managerUserId: scopedManagerUserId } : {}),
            ...(scopedFilters.length ? { AND: scopedFilters } : {}),
          },
          select: {
            id: true,
            customerId: true,
            tariffId: true,
            coursePriceAmount: true,
            paymentAmount: true,
            remainingDebtAmount: true,
            entryDate: true,
            customer: {
              select: {
                profileTariffId: true,
                profileSubTariffId: true,
              },
            },
          },
        }),
        input.subTariffId
          ? prisma.subTariff.findMany({
              where: {
                tenantId: ctx.tenantId,
                id: input.subTariffId,
              },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
      ]);

      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurs topilmadi.' });
      }

      const saleIds = matchedSales.map((sale) => sale.id);
      const saleIdSet = new Set(saleIds);
      const rangeIncomeBySaleId = new Map<string, number>();
      const currentIncomeBySaleId = new Map<string, number>();
      if (saleIds.length > 0) {
        const [rangeIncomes, allIncomes] = await Promise.all([
          prisma.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              entryDate: {
                gte: rangeStart,
                lte: rangeEnd,
              },
              OR: [
                { id: { in: saleIds } },
                { relatedDebtIncomeId: { in: saleIds } },
              ],
            },
            select: {
              id: true,
              relatedDebtIncomeId: true,
              paymentAmount: true,
            },
          }),
          prisma.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              OR: [
                { id: { in: saleIds } },
                { relatedDebtIncomeId: { in: saleIds } },
              ],
            },
            select: {
              id: true,
              relatedDebtIncomeId: true,
              paymentAmount: true,
            },
          }),
        ]);

        for (const income of rangeIncomes) {
          const saleId = income.relatedDebtIncomeId || income.id;
          if (!saleIdSet.has(saleId)) {
            continue;
          }
          rangeIncomeBySaleId.set(saleId, (rangeIncomeBySaleId.get(saleId) ?? 0) + (income.paymentAmount ?? 0));
        }

        for (const income of allIncomes) {
          const saleId = income.relatedDebtIncomeId || income.id;
          if (!saleIdSet.has(saleId)) {
            continue;
          }
          currentIncomeBySaleId.set(saleId, (currentIncomeBySaleId.get(saleId) ?? 0) + (income.paymentAmount ?? 0));
        }
      }

      let rangeAgreementAmount = 0;
      let currentAgreementAmount = 0;
      let currentDebtAmount = 0;
      for (const sale of matchedSales) {
        currentAgreementAmount += sale.coursePriceAmount ?? sale.paymentAmount ?? 0;
        if (sale.entryDate >= rangeStart && sale.entryDate <= rangeEnd) {
          rangeAgreementAmount += sale.coursePriceAmount ?? sale.paymentAmount ?? 0;
        }
        currentDebtAmount += sale.remainingDebtAmount ?? 0;
      }
      const rangeIncomeAmount = Array.from(rangeIncomeBySaleId.values()).reduce((sum, value) => sum + value, 0);
      const currentIncomeAmount = Array.from(currentIncomeBySaleId.values()).reduce((sum, value) => sum + value, 0);
      const currentCustomerCount = new Set(matchedSales.map((sale) => sale.customerId)).size;

      const tariffCustomerSets = new Map<string, Set<string>>();
      for (const tariff of course.tariffs) {
        tariffCustomerSets.set(tariff.id, new Set());
      }
      const selectedTariff = input.tariffId
        ? course.tariffs.find((tariff) => tariff.id === input.tariffId) || null
        : null;
      const subTariffCustomerSets = new Map<string, Set<string>>();
      if (selectedTariff) {
        for (const subTariff of selectedTariff.subTariffs || []) {
          subTariffCustomerSets.set(subTariff.id, new Set());
        }
      }
      for (const sale of matchedSales) {
        const effectiveTariffId = sale.tariffId;
        if (!effectiveTariffId) {
          continue;
        }
        const set = tariffCustomerSets.get(effectiveTariffId);
        if (set) {
          set.add(sale.customerId);
        }
        if (selectedTariff && effectiveTariffId === selectedTariff.id && sale.customer.profileSubTariffId) {
          const subTariffSet = subTariffCustomerSets.get(sale.customer.profileSubTariffId);
          if (subTariffSet) {
            subTariffSet.add(sale.customerId);
          }
        }
      }

      const selectedSubTariffName = profileSubTariffs[0]?.name || null;

      return {
        range: input.range,
        dateFrom: input.range === 'custom' ? input.dateFrom || null : null,
        dateTo: input.range === 'custom' ? input.dateTo || null : null,
        course: {
          id: course.id,
          name: course.name,
          category: String(course.category || '').trim().toLowerCase(),
          categoryLabel: buildCategoryLabel(String(course.category || '')),
        },
        selectedTariffId: input.tariffId || null,
        selectedSubTariffId: input.subTariffId || null,
        selectedSubTariffName,
        totals: {
          currentCustomerCount,
          currentAgreementAmount,
          currentIncomeAmount,
          rangeAgreementAmount,
          rangeIncomeAmount,
          currentDebtAmount,
        },
        tariffDistribution: course.tariffs.map((tariff) => ({
          tariffId: tariff.id,
          tariffName: tariff.name,
          customerCount: tariffCustomerSets.get(tariff.id)?.size ?? 0,
          isSelected: input.tariffId ? input.tariffId === tariff.id : false,
        })),
        subTariffDistribution: selectedTariff
          ? (selectedTariff.subTariffs || []).map((subTariff) => ({
              subTariffId: subTariff.id,
              subTariffName: subTariff.name,
              customerCount: subTariffCustomerSets.get(subTariff.id)?.size ?? 0,
              isSelected: input.subTariffId ? input.subTariffId === subTariff.id : false,
            }))
          : [],
        updatedAt: now.toISOString(),
      };
    }),

  customers: protectedProcedure
    .input(
      z.object({
        courseId: z.string().uuid(),
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
      const scopedFilters: Record<string, unknown>[] = [];
      if (input.courseId) {
        scopedFilters.push({ courseId: input.courseId });
      }
      if (input.tariffId) {
        scopedFilters.push({ tariffId: input.tariffId });
      }
      if (input.subTariffId) {
        scopedFilters.push({
          customer: { profileSubTariffId: input.subTariffId },
        });
      }

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
        prisma.income.count({ where }),
        prisma.income.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }],
          skip,
          take: input.limit,
          select: {
            id: true,
            customerId: true,
            entryDate: true,
            coursePriceAmount: true,
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

      const saleIds = sales.map((sale) => sale.id);
      const customerIds = Array.from(new Set(sales.map((sale) => sale.customerId)));
      const profileSubTariffIds = Array.from(
        new Set(
          sales
            .map((sale) => sale.customer.profileSubTariffId)
            .filter((value): value is string => Boolean(value)),
        ),
      );
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

      const [incomes, subTariffs, profileCourses, profileTariffs, allActiveSalesByCustomer] = await Promise.all([
        saleIds.length > 0
          ? prisma.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
                OR: [
                  { id: { in: saleIds } },
                  { relatedDebtIncomeId: { in: saleIds } },
                ],
              },
              select: {
                id: true,
                relatedDebtIncomeId: true,
                paymentAmount: true,
                entryDate: true,
              },
            })
          : Promise.resolve([]),
        profileSubTariffIds.length > 0
          ? prisma.subTariff.findMany({
              where: {
                tenantId: ctx.tenantId,
                id: { in: profileSubTariffIds },
              },
              select: {
                id: true,
                name: true,
              },
            })
          : Promise.resolve([]),
        profileCourseIds.length > 0
          ? prisma.course.findMany({
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
          ? prisma.tariff.findMany({
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
          ? prisma.income.findMany({
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
                course: {
                  select: { name: true },
                },
                tariff: {
                  select: { name: true },
                },
              },
            })
          : Promise.resolve([]),
      ]);

      const subTariffNameById = new Map(subTariffs.map((subTariff) => [subTariff.id, subTariff.name]));
      const profileCourseNameById = new Map(profileCourses.map((course) => [course.id, course.name]));
      const profileTariffNameById = new Map(profileTariffs.map((tariff) => [tariff.id, tariff.name]));
      const customerCoursesByCustomer = buildCustomerCoursesByCustomer(
        allActiveSalesByCustomer as Array<{
          id: string;
          customerId: string;
          entryDate: Date;
          remainingDebtAmount: number;
          course: { name: string } | null;
          tariff: { name: string } | null;
        }>,
      );
      const paidBySaleId = new Map<string, number>();
      const lastActivityBySaleId = new Map<string, Date>();
      const saleIdSet = new Set(saleIds);

      for (const income of incomes) {
        const saleId = income.relatedDebtIncomeId || income.id;
        if (!saleIdSet.has(saleId)) {
          continue;
        }
        paidBySaleId.set(saleId, (paidBySaleId.get(saleId) ?? 0) + (income.paymentAmount ?? 0));
        const currentLast = lastActivityBySaleId.get(saleId);
        if (!currentLast || income.entryDate > currentLast) {
          lastActivityBySaleId.set(saleId, income.entryDate);
        }
      }

      return {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / input.limit)),
        rows: sales.map((sale) => {
          const paidAmount = paidBySaleId.get(sale.id) ?? (sale.paymentAmount ?? 0);
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
          return {
            saleId: sale.id,
            customerId: sale.customerId,
            customerNumber: sale.customer.customerNumber,
            customerName: sale.customer.name,
            telegramUsername: sale.customer.telegramUsername || null,
            managerUserId: sale.manager.id,
            managerLabel,
            courseName: sale.course?.name || profileCourseName || null,
            tariffName: sale.tariff?.name || profileTariffName || null,
            subTariffName: profileSubTariffName,
            agreementAmount: sale.coursePriceAmount ?? sale.paymentAmount ?? 0,
            paidAmount,
            debtAmount: sale.remainingDebtAmount ?? 0,
            entryDate: sale.entryDate.toISOString(),
            lastActivityAt: (lastActivityBySaleId.get(sale.id) || sale.entryDate).toISOString(),
            customerCourses: customerCoursesByCustomer.get(sale.customerId) || [],
          };
        }),
      };
    }),

  courseDetail: protectedProcedure
    .input(
      z.object({
        courseId: z.string().uuid(),
        tariffId: z.string().uuid().optional(),
        subTariffId: z.string().uuid().optional(),
        range: courseSalesRangeSchema,
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : undefined;
      const scopedFilters: Record<string, unknown>[] = [];
      if (input.courseId) {
        scopedFilters.push({ courseId: input.courseId });
      }
      if (input.tariffId) {
        scopedFilters.push({ tariffId: input.tariffId });
      }
      if (input.subTariffId) {
        scopedFilters.push({
          customer: { profileSubTariffId: input.subTariffId },
        });
      }

      const [course, sales] = await Promise.all([
        prisma.course.findFirst({
          where: {
            tenantId: ctx.tenantId,
            id: input.courseId,
            isActive: true,
          },
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
              },
            },
          },
        }),
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'new_sale',
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            ...(scopedManagerUserId ? { managerUserId: scopedManagerUserId } : {}),
            ...(scopedFilters.length ? { AND: scopedFilters } : {}),
          },
          select: {
            id: true,
            customerId: true,
            managerUserId: true,
            tariffId: true,
            entryDate: true,
            coursePriceAmount: true,
            paymentAmount: true,
            remainingDebtAmount: true,
            customer: {
              select: {
                profileTariffId: true,
                profileSubTariffId: true,
              },
            },
            manager: {
              select: {
                id: true,
                name: true,
                username: true,
              },
            },
          },
        }),
      ]);

      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurs topilmadi.' });
      }

      const saleIds = sales.map((sale) => sale.id);
      const profileSubTariffIds = Array.from(
        new Set(
          sales
            .map((sale) => sale.customer.profileSubTariffId)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      const [rangeIncomes, allIncomes, subTariffs] = await Promise.all([
        saleIds.length > 0
          ? prisma.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
                entryDate: {
                  gte: rangeStart,
                  lte: rangeEnd,
                },
                OR: [
                  { id: { in: saleIds } },
                  { relatedDebtIncomeId: { in: saleIds } },
                ],
              },
              select: {
                id: true,
                relatedDebtIncomeId: true,
                paymentAmount: true,
              },
            })
          : Promise.resolve([]),
        saleIds.length > 0
          ? prisma.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
                OR: [
                  { id: { in: saleIds } },
                  { relatedDebtIncomeId: { in: saleIds } },
                ],
              },
              select: {
                id: true,
                relatedDebtIncomeId: true,
                paymentAmount: true,
              },
            })
          : Promise.resolve([]),
        profileSubTariffIds.length > 0
          ? prisma.subTariff.findMany({
              where: {
                tenantId: ctx.tenantId,
                id: { in: profileSubTariffIds },
              },
              select: {
                id: true,
                name: true,
              },
            })
          : Promise.resolve([]),
      ]);

      const saleIdSet = new Set(saleIds);
      const incomeBySaleId = new Map<string, number>();
      const currentIncomeBySaleId = new Map<string, number>();
      for (const income of rangeIncomes) {
        const saleId = income.relatedDebtIncomeId || income.id;
        if (!saleIdSet.has(saleId)) {
          continue;
        }
        incomeBySaleId.set(saleId, (incomeBySaleId.get(saleId) ?? 0) + (income.paymentAmount ?? 0));
      }
      for (const income of allIncomes) {
        const saleId = income.relatedDebtIncomeId || income.id;
        if (!saleIdSet.has(saleId)) {
          continue;
        }
        currentIncomeBySaleId.set(saleId, (currentIncomeBySaleId.get(saleId) ?? 0) + (income.paymentAmount ?? 0));
      }

      const subTariffNameById = new Map(subTariffs.map((subTariff) => [subTariff.id, normalizeSubTariffName(subTariff.name)]));

      let rangeAgreementAmount = 0;
      let currentAgreementAmount = 0;
      let currentDebtAmount = 0;
      let vipCount = 0;
      let standartCount = 0;
      for (const sale of sales) {
        currentAgreementAmount += sale.coursePriceAmount ?? sale.paymentAmount ?? 0;
        if (sale.entryDate >= rangeStart && sale.entryDate <= rangeEnd) {
          rangeAgreementAmount += sale.coursePriceAmount ?? sale.paymentAmount ?? 0;
        }
        currentDebtAmount += sale.remainingDebtAmount ?? 0;
        const subTariffName = sale.customer.profileSubTariffId
          ? subTariffNameById.get(sale.customer.profileSubTariffId) || ''
          : '';
        if (subTariffName.includes('vip')) {
          vipCount += 1;
        }
        if (subTariffName.includes('standart')) {
          standartCount += 1;
        }
      }
      const currentCustomerCount = new Set(sales.map((sale) => sale.customerId)).size;
      const rangeIncomeAmount = Array.from(incomeBySaleId.values()).reduce((sum, value) => sum + value, 0);
      const currentIncomeAmount = Array.from(currentIncomeBySaleId.values()).reduce((sum, value) => sum + value, 0);
      const collectionPercent = rangeAgreementAmount > 0
        ? Number(((rangeIncomeAmount / rangeAgreementAmount) * 100).toFixed(1))
        : 0;

      const tariffRowMap = new Map<
        string,
        {
          tariffId: string;
          tariffName: string;
          saleIds: string[];
          customerIds: Set<string>;
          agreementAmount: number;
          debtAmount: number;
          incomeAmount: number;
        }
      >();
      for (const tariff of course.tariffs) {
        tariffRowMap.set(tariff.id, {
          tariffId: tariff.id,
          tariffName: tariff.name,
          saleIds: [],
          customerIds: new Set(),
          agreementAmount: 0,
          debtAmount: 0,
          incomeAmount: 0,
        });
      }

      const managerMap = new Map<
        string,
        {
          managerUserId: string;
          managerLabel: string;
          saleCount: number;
          customerIds: Set<string>;
          agreementAmount: number;
          debtAmount: number;
          incomeAmount: number;
        }
      >();

      for (const sale of sales) {
        const effectiveTariffId = sale.tariffId;
        if (effectiveTariffId) {
          const row = tariffRowMap.get(effectiveTariffId);
          if (row) {
            row.saleIds.push(sale.id);
            row.customerIds.add(sale.customerId);
            if (sale.entryDate >= rangeStart && sale.entryDate <= rangeEnd) {
              row.agreementAmount += sale.coursePriceAmount ?? sale.paymentAmount ?? 0;
            }
            row.debtAmount += sale.remainingDebtAmount ?? 0;
          }
        }

        const managerLabel = sale.manager.name || sale.manager.username || sale.manager.id;
        const managerRow = managerMap.get(sale.managerUserId) || {
          managerUserId: sale.managerUserId,
          managerLabel,
          saleCount: 0,
          customerIds: new Set<string>(),
          agreementAmount: 0,
          debtAmount: 0,
          incomeAmount: 0,
        };
        managerRow.saleCount += 1;
        managerRow.customerIds.add(sale.customerId);
        if (sale.entryDate >= rangeStart && sale.entryDate <= rangeEnd) {
          managerRow.agreementAmount += sale.coursePriceAmount ?? sale.paymentAmount ?? 0;
        }
        managerRow.debtAmount += sale.remainingDebtAmount ?? 0;
        managerMap.set(sale.managerUserId, managerRow);
      }

      const saleById = new Map(sales.map((sale) => [sale.id, sale]));

      for (const [saleId, amount] of incomeBySaleId.entries()) {
        const sale = saleById.get(saleId);
        if (!sale) {
          continue;
        }
        if (sale.tariffId) {
          const row = tariffRowMap.get(sale.tariffId);
          if (row) {
            row.incomeAmount += amount;
          }
        }
        const managerRow = managerMap.get(sale.managerUserId);
        if (managerRow) {
          managerRow.incomeAmount += amount;
        }
      }

      const tariffRows = Array.from(tariffRowMap.values()).map((row) => {
        const collectionPercentByTariff = row.agreementAmount > 0
          ? Number(((row.incomeAmount / row.agreementAmount) * 100).toFixed(1))
          : 0;
        return {
          tariffId: row.tariffId,
          tariffName: row.tariffName,
          customerCount: row.customerIds.size,
          saleCount: row.saleIds.length,
          agreementAmount: row.agreementAmount,
          incomeAmount: row.incomeAmount,
          debtAmount: row.debtAmount,
          collectionPercent: collectionPercentByTariff,
          isSelected: input.tariffId ? input.tariffId === row.tariffId : false,
        };
      });

      const managerRows = Array.from(managerMap.values())
        .map((row) => {
          const collectionPercentByManager = row.agreementAmount > 0
            ? Number(((row.incomeAmount / row.agreementAmount) * 100).toFixed(1))
            : 0;
          return {
            managerUserId: row.managerUserId,
            managerLabel: row.managerLabel,
            saleCount: row.saleCount,
            customerCount: row.customerIds.size,
            agreementAmount: row.agreementAmount,
            incomeAmount: row.incomeAmount,
            debtAmount: row.debtAmount,
            collectionPercent: collectionPercentByManager,
          };
        })
        .sort((a, b) => b.incomeAmount - a.incomeAmount);

      return {
        range: input.range,
        dateFrom: input.range === 'custom' ? input.dateFrom || null : null,
        dateTo: input.range === 'custom' ? input.dateTo || null : null,
        course: {
          id: course.id,
          name: course.name,
          category: String(course.category || '').trim().toLowerCase(),
          categoryLabel: buildCategoryLabel(String(course.category || '')),
        },
        selectedTariffId: input.tariffId || null,
        selectedSubTariffId: input.subTariffId || null,
        summary: {
          factSalesCount: sales.length,
          currentCustomerCount,
          currentAgreementAmount,
          currentIncomeAmount,
          rangeAgreementAmount,
          rangeIncomeAmount,
          currentDebtAmount,
          vipCount,
          standartCount,
          vipPercent: currentCustomerCount > 0 ? Number(((vipCount / currentCustomerCount) * 100).toFixed(1)) : 0,
          collectionPercent,
        },
        tariffRows,
        managerRows,
        updatedAt: now.toISOString(),
      };
    }),
});
