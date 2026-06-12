import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { hasAgentRole } from '@dashboarduz/shared';
import { protectedProcedure, router } from '../trpc';
import { buildSaleChainMetricsBySaleId, type SaleChainSaleRow } from '../../services/income-chain';
import { resolveEffectiveAgreementAmount } from '../../services/technical-income';

const courseSalesRangeSchema = z.enum(['today', 'week', 'month', 'custom']);
const courseSalesTypeCategorySchema = z.enum(['online', 'offline', 'intensive']);
const REPORT_TZ_OFFSET_MINUTES = 5 * 60; // GMT+5
const INCOME_LIFECYCLE_ACTIVE = 'active';
const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'TeamLeader', 'Finance']);
const SALE_SUB_TARIFF_META_KEY = 'saleSubTariffId';

type CourseSalesRange = z.infer<typeof courseSalesRangeSchema>;

function isAgentOnly(roles: string[]): boolean {
  return hasAgentRole(roles) && !roles.some((role) => PRIVILEGED_ROLES.has(role));
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

function extractSaleSubTariffId(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return null;
  }
  const candidate = (meta as Record<string, unknown>)[SALE_SUB_TARIFF_META_KEY];
  if (typeof candidate !== 'string') {
    return null;
  }
  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : null;
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
  courseId: string | null;
  tariffId: string | null;
  subTariffId: string | null;
  courseName: string | null;
  tariffName: string | null;
  subTariffName: string | null;
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
    legacyImportMeta: unknown;
    course: { id: string; name: string } | null;
    tariff: { id: string; name: string } | null;
    customer: {
      profileCourseId: string | null;
      profileTariffId: string | null;
      profileSubTariffId: string | null;
    };
  }>,
  subTariffNameById: Map<string, string>,
  chainMetricsBySaleId?: Map<string, { currentDebtAmount: number }>,
): Map<string, CustomerCourseEntry[]> {
  const map = new Map<string, CustomerCourseEntry[]>();
  for (const sale of activeSales) {
    const saleSubTariffId = extractSaleSubTariffId(sale.legacyImportMeta);
    const isCurrentProfileSale = Boolean(
      sale.customer.profileCourseId
      && sale.customer.profileTariffId
      && sale.customer.profileCourseId === sale.course?.id
      && sale.customer.profileTariffId === sale.tariff?.id,
    );
    const profileSubTariffId = isCurrentProfileSale ? (sale.customer.profileSubTariffId || null) : null;
    const effectiveSubTariffId = saleSubTariffId || profileSubTariffId;
    const subTariffName = effectiveSubTariffId
      ? subTariffNameById.get(effectiveSubTariffId) || null
      : null;
    const labelParts = [sale.course?.name || null, sale.tariff?.name || null, subTariffName].filter(Boolean);
    const label = labelParts.length ? labelParts.join(' / ') : "Noma'lum kurs";
    const rows = map.get(sale.customerId) || [];
    rows.push({
      saleIncomeId: sale.id,
      courseId: sale.course?.id || null,
      tariffId: sale.tariff?.id || null,
      subTariffId: effectiveSubTariffId || null,
      courseName: sale.course?.name || null,
      tariffName: sale.tariff?.name || null,
      subTariffName,
      label,
      entryDate: sale.entryDate.toISOString(),
      remainingDebtAmount: chainMetricsBySaleId?.get(sale.id)?.currentDebtAmount ?? (sale.remainingDebtAmount || 0),
    });
    map.set(sale.customerId, rows);
  }

  for (const [customerId, rows] of map.entries()) {
    rows.sort((a, b) => b.entryDate.localeCompare(a.entryDate));
    map.set(customerId, rows);
  }

  return map;
}

async function buildActiveSaleChainMetrics(params: {
  tenantId: string;
  sales: SaleChainSaleRow[];
}) {
  if (params.sales.length === 0) {
    return new Map<string, {
      agreementAmount: number;
      paidAmount: number;
      currentDebtAmount: number;
      lastActivityAt: Date;
    }>();
  }

  const saleIds = params.sales.map((sale) => sale.id);
  const chainRows = await prisma.income.findMany({
    where: {
      tenantId: params.tenantId,
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
  });

  return buildSaleChainMetricsBySaleId({
    sales: params.sales,
    chainRows,
  });
}

function buildTechnicalSaleIdSetByAgreement(params: {
  sales: Array<{
    id: string;
    type?: string | null;
    coursePriceAmount?: number | null;
    debtAmount?: number | null;
    paymentAmount?: number | null;
  }>;
  chainMetricsBySaleId: Map<string, { agreementAmount: number }>;
}) {
  const saleIds = new Set<string>();
  for (const sale of params.sales) {
    if (sale.type !== 'new_sale') {
      continue;
    }
    const chainAgreement = params.chainMetricsBySaleId.get(sale.id)?.agreementAmount;
    const fallbackAgreement = resolveEffectiveAgreementAmount(sale);
    if (Number(chainAgreement ?? 0) === 1 || Number(fallbackAgreement ?? 0) === 1) {
      saleIds.add(sale.id);
    }
  }
  return saleIds;
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
          tariffCustomerBreakdown: {
            vip: 0,
            premium: 0,
            standart: 0,
          },
          salesBreakdown: {
            newSalesCount: 0,
            movedInCount: 0,
            serviceExchangeCount: 0,
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
          entryDate: true,
          customerId: true,
          courseId: true,
          tariffId: true,
          coursePriceAmount: true,
          debtAmount: true,
          paymentAmount: true,
          remainingDebtAmount: true,
          legacyImportMeta: true,
          customer: {
            select: {
              profileCourseId: true,
              profileTariffId: true,
              profileSubTariffId: true,
            },
          },
          tariff: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
      const salesWithResolvedSubTariff = matchedSales.map((sale) => {
        const saleSubTariffId = extractSaleSubTariffId(sale.legacyImportMeta);
        const profileMatchedSubTariffId = (
          sale.customer.profileCourseId === sale.courseId
          && sale.customer.profileTariffId
          && sale.customer.profileTariffId === sale.tariffId
        )
          ? sale.customer.profileSubTariffId || null
          : null;
        return {
          ...sale,
          resolvedSubTariffId: saleSubTariffId || profileMatchedSubTariffId || null,
        };
      });
      const filteredSales = input.subTariffId
        ? salesWithResolvedSubTariff.filter((sale) => sale.resolvedSubTariffId === input.subTariffId)
        : salesWithResolvedSubTariff;
      const allChainMetricsBySaleId = await buildActiveSaleChainMetrics({
        tenantId: ctx.tenantId,
        sales: filteredSales as SaleChainSaleRow[],
      });
      const technicalSaleIds = buildTechnicalSaleIdSetByAgreement({
        sales: filteredSales,
        chainMetricsBySaleId: allChainMetricsBySaleId,
      });
      const filteredNonTechnicalSales = filteredSales.filter((sale) => !technicalSaleIds.has(sale.id));
      const nonTechnicalSaleIdSet = new Set(filteredNonTechnicalSales.map((sale) => sale.id));
      const nonTechnicalSaleCustomerById = new Map(filteredNonTechnicalSales.map((sale) => [sale.id, sale.customerId]));
      const chainMetricsBySaleId = new Map(
        Array.from(allChainMetricsBySaleId.entries()).filter(([saleId]) => nonTechnicalSaleIdSet.has(saleId)),
      );
      const technicalCustomerCount = new Set(
        filteredSales
          .filter((sale) => technicalSaleIds.has(sale.id))
          .map((sale) => sale.customerId),
      ).size;
      let movedInCount = 0;
      const movedInSaleIdSet = new Set<string>();
      if (nonTechnicalSaleIdSet.size > 0) {
        const [relinkLogs, tariffChangeRequests, saleUpdateLogs] = await Promise.all([
          prisma.auditLog.findMany({
            where: {
              tenantId: ctx.tenantId,
              action: { in: ['customer_course_relink', 'income_debug_destructive_relink'] },
            },
            select: {
              metadata: true,
            },
          }),
          prisma.incomeAdjustmentRequest.findMany({
            where: {
              tenantId: ctx.tenantId,
              type: 'tariff_change',
              status: 'approved',
              incomeId: { in: Array.from(nonTechnicalSaleIdSet) },
              ...(input.courseId ? { newCourseId: input.courseId } : {}),
              ...(input.tariffId ? { newTariffId: input.tariffId } : {}),
            },
            select: {
              incomeId: true,
              customerId: true,
            },
          }),
          prisma.auditLog.findMany({
            where: {
              tenantId: ctx.tenantId,
              action: 'customer_course_sale_update',
              resourceId: { in: Array.from(nonTechnicalSaleIdSet) },
            },
            select: {
              resourceId: true,
              metadata: true,
            },
          }),
        ]);
        const movedCustomerIds = new Set<string>();
        for (const log of relinkLogs) {
          const metadata = (log.metadata && typeof log.metadata === 'object')
            ? (log.metadata as Record<string, unknown>)
            : null;
          if (!metadata) {
            continue;
          }
          const targetSaleIncomeId = typeof metadata.targetSaleIncomeId === 'string'
            ? metadata.targetSaleIncomeId
            : '';
          if (!targetSaleIncomeId || !nonTechnicalSaleIdSet.has(targetSaleIncomeId)) {
            continue;
          }
          movedInSaleIdSet.add(targetSaleIncomeId);
          const customerId = typeof metadata.customerId === 'string'
            ? metadata.customerId
            : (nonTechnicalSaleCustomerById.get(targetSaleIncomeId) || '');
          if (customerId) {
            movedCustomerIds.add(customerId);
          }
        }
        for (const request of tariffChangeRequests) {
          movedInSaleIdSet.add(request.incomeId);
          movedCustomerIds.add(request.customerId);
        }
        for (const log of saleUpdateLogs) {
          const saleId = log.resourceId || '';
          const metadata = (log.metadata && typeof log.metadata === 'object')
            ? (log.metadata as Record<string, unknown>)
            : null;
          const newCourseId = typeof metadata?.newCourseId === 'string' ? metadata.newCourseId : '';
          const newTariffId = typeof metadata?.newTariffId === 'string' ? metadata.newTariffId : '';
          if (input.courseId && newCourseId && newCourseId !== input.courseId) {
            continue;
          }
          if (input.tariffId && newTariffId && newTariffId !== input.tariffId) {
            continue;
          }
          if (!saleId || !nonTechnicalSaleIdSet.has(saleId)) {
            continue;
          }
          movedInSaleIdSet.add(saleId);
          const customerId = nonTechnicalSaleCustomerById.get(saleId) || '';
          if (customerId) {
            movedCustomerIds.add(customerId);
          }
        }
        movedInCount = movedCustomerIds.size;
      }
      const directNewSalesCount = filteredNonTechnicalSales.filter((sale) => !movedInSaleIdSet.has(sale.id)).length;

      let agreementAmount = 0;
      let remainingDebtAmount = 0;
      let paidAmount = 0;
      let fullyPaidCount = 0;
      let debtorsCount = 0;
      const vipCustomerIds = new Set<string>();
      const premiumCustomerIds = new Set<string>();
      const standartCustomerIds = new Set<string>();
      for (const sale of filteredNonTechnicalSales) {
        const metric = chainMetricsBySaleId.get(sale.id);
        const agreement = metric?.agreementAmount ?? (sale.coursePriceAmount ?? sale.debtAmount ?? sale.paymentAmount ?? 0);
        const debt = metric?.currentDebtAmount ?? (sale.remainingDebtAmount ?? 0);
        const paid = metric?.paidAmount ?? (sale.paymentAmount ?? 0);
        agreementAmount += agreement;
        remainingDebtAmount += debt;
        paidAmount += paid;
        if (debt <= 0) {
          fullyPaidCount += 1;
        } else {
          debtorsCount += 1;
        }
        const tariffName = String(sale.tariff?.name || '').trim().toLowerCase();
        if (tariffName.includes('vip')) {
          vipCustomerIds.add(sale.customerId);
        } else if (tariffName.includes('premium')) {
          premiumCustomerIds.add(sale.customerId);
        } else if (tariffName.includes('standart') || tariffName.includes('standard')) {
          standartCustomerIds.add(sale.customerId);
        }
      }

      return {
        category: input.category,
        categoryLabel: buildCategoryLabel(input.category),
        selectedCourseId: input.courseId || null,
        selectedTariffId: input.tariffId || null,
        selectedSubTariffId: input.subTariffId || null,
        totals: {
          soldCount: filteredNonTechnicalSales.length,
          fullyPaidCount,
          debtorsCount,
          agreementAmount,
          paidAmount,
          remainingDebtAmount,
          customerCount: new Set(filteredNonTechnicalSales.map((sale) => sale.customerId)).size,
        },
        tariffCustomerBreakdown: {
          vip: vipCustomerIds.size,
          premium: premiumCustomerIds.size,
          standart: standartCustomerIds.size,
        },
        salesBreakdown: {
          newSalesCount: directNewSalesCount,
          movedInCount,
          serviceExchangeCount: technicalCustomerCount,
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
          ? prisma.subTariff.findMany({
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
      });
      const allCustomerChainMetricsBySaleId = await buildActiveSaleChainMetrics({
        tenantId: ctx.tenantId,
        sales: allActiveSalesByCustomer as SaleChainSaleRow[],
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
          const agreementAmount = metric?.agreementAmount ?? (sale.coursePriceAmount ?? sale.debtAmount ?? sale.paymentAmount ?? 0);
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
                profileCourseId: true,
                profileTariffId: true,
                profileSubTariffId: true,
              },
            },
            legacyImportMeta: true,
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

      const salesWithResolvedSubTariff = matchedSales.map((sale) => {
        const saleSubTariffId = extractSaleSubTariffId(sale.legacyImportMeta);
        const profileMatchedSubTariffId = (
          sale.customer.profileCourseId === input.courseId
          && sale.customer.profileTariffId
          && sale.customer.profileTariffId === sale.tariffId
        )
          ? sale.customer.profileSubTariffId || null
          : null;
        return {
          ...sale,
          resolvedSubTariffId: saleSubTariffId || profileMatchedSubTariffId || null,
        };
      });

      const filteredSales = input.subTariffId
        ? salesWithResolvedSubTariff.filter((sale) => sale.resolvedSubTariffId === input.subTariffId)
        : salesWithResolvedSubTariff;
      const allChainMetricsBySaleId = await buildActiveSaleChainMetrics({
        tenantId: ctx.tenantId,
        sales: filteredSales as SaleChainSaleRow[],
      });
      const technicalSaleIds = buildTechnicalSaleIdSetByAgreement({
        sales: filteredSales,
        chainMetricsBySaleId: allChainMetricsBySaleId,
      });
      const filteredNonTechnicalSales = filteredSales.filter((sale) => !technicalSaleIds.has(sale.id));
      const nonTechnicalSaleIdSet = new Set(filteredNonTechnicalSales.map((sale) => sale.id));
      const chainMetricsBySaleId = new Map(
        Array.from(allChainMetricsBySaleId.entries()).filter(([saleId]) => nonTechnicalSaleIdSet.has(saleId)),
      );

      const saleIds = filteredNonTechnicalSales.map((sale) => sale.id);
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
      for (const sale of filteredNonTechnicalSales) {
        const metric = chainMetricsBySaleId.get(sale.id);
        const agreement = metric?.agreementAmount ?? (sale.coursePriceAmount ?? sale.paymentAmount ?? 0);
        const debt = metric?.currentDebtAmount ?? (sale.remainingDebtAmount ?? 0);
        currentAgreementAmount += agreement;
        if (sale.entryDate >= rangeStart && sale.entryDate <= rangeEnd) {
          rangeAgreementAmount += agreement;
        }
        currentDebtAmount += debt;
      }
      const rangeIncomeAmount = Array.from(rangeIncomeBySaleId.values()).reduce((sum, value) => sum + value, 0);
      const currentIncomeAmount = filteredNonTechnicalSales.reduce((sum, sale) => {
        const metric = chainMetricsBySaleId.get(sale.id);
        return sum + (metric?.paidAmount ?? currentIncomeBySaleId.get(sale.id) ?? 0);
      }, 0);
      const currentCustomerCount = new Set(filteredNonTechnicalSales.map((sale) => sale.customerId)).size;

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
      for (const sale of filteredNonTechnicalSales) {
        const effectiveTariffId = sale.tariffId;
        if (!effectiveTariffId) {
          continue;
        }
        const set = tariffCustomerSets.get(effectiveTariffId);
        if (set) {
          set.add(sale.customerId);
        }
        if (selectedTariff && effectiveTariffId === selectedTariff.id && sale.resolvedSubTariffId) {
          const subTariffSet = subTariffCustomerSets.get(sale.resolvedSubTariffId);
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
        range: courseSalesRangeSchema.default('month'),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        query: z.string().trim().max(120).optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : undefined;
      const query = input.query?.trim();
      const skip = (input.page - 1) * input.limit;
      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
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
        entryDate: {
          gte: rangeStart,
          lte: rangeEnd,
        },
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
          ? prisma.subTariff.findMany({
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
      });
      const allCustomerChainMetricsBySaleId = await buildActiveSaleChainMetrics({
        tenantId: ctx.tenantId,
        sales: allActiveSalesByCustomer as SaleChainSaleRow[],
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
          const agreementAmount = metric?.agreementAmount ?? (sale.coursePriceAmount ?? sale.debtAmount ?? sale.paymentAmount ?? 0);
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

      const allChainMetricsBySaleId = await buildActiveSaleChainMetrics({
        tenantId: ctx.tenantId,
        sales: sales,
      });
      const technicalSaleIds = buildTechnicalSaleIdSetByAgreement({
        sales,
        chainMetricsBySaleId: allChainMetricsBySaleId,
      });
      const nonTechnicalSales = sales.filter((sale) => !technicalSaleIds.has(sale.id));
      const saleIds = nonTechnicalSales.map((sale) => sale.id);
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
      const nonTechnicalSaleIdSet = new Set(nonTechnicalSales.map((sale) => sale.id));
      const chainMetricsBySaleId = new Map(
        Array.from(allChainMetricsBySaleId.entries()).filter(([saleId]) => nonTechnicalSaleIdSet.has(saleId)),
      );
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
      for (const sale of nonTechnicalSales) {
        const metric = chainMetricsBySaleId.get(sale.id);
        const agreement = metric?.agreementAmount ?? (sale.coursePriceAmount ?? sale.paymentAmount ?? 0);
        const debt = metric?.currentDebtAmount ?? (sale.remainingDebtAmount ?? 0);
        currentAgreementAmount += agreement;
        if (sale.entryDate >= rangeStart && sale.entryDate <= rangeEnd) {
          rangeAgreementAmount += agreement;
        }
        currentDebtAmount += debt;
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
      const currentCustomerCount = new Set(nonTechnicalSales.map((sale) => sale.customerId)).size;
      const rangeIncomeAmount = Array.from(incomeBySaleId.values()).reduce((sum, value) => sum + value, 0);
      const currentIncomeAmount = nonTechnicalSales.reduce((sum, sale) => {
        const metric = chainMetricsBySaleId.get(sale.id);
        return sum + (metric?.paidAmount ?? currentIncomeBySaleId.get(sale.id) ?? 0);
      }, 0);
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

      for (const sale of nonTechnicalSales) {
        const effectiveTariffId = sale.tariffId;
        if (effectiveTariffId) {
          const row = tariffRowMap.get(effectiveTariffId);
          if (row) {
            row.saleIds.push(sale.id);
            row.customerIds.add(sale.customerId);
            if (sale.entryDate >= rangeStart && sale.entryDate <= rangeEnd) {
              row.agreementAmount += chainMetricsBySaleId.get(sale.id)?.agreementAmount
                ?? (sale.coursePriceAmount ?? sale.paymentAmount ?? 0);
            }
            row.debtAmount += chainMetricsBySaleId.get(sale.id)?.currentDebtAmount ?? (sale.remainingDebtAmount ?? 0);
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
          managerRow.agreementAmount += chainMetricsBySaleId.get(sale.id)?.agreementAmount
            ?? (sale.coursePriceAmount ?? sale.paymentAmount ?? 0);
        }
        managerRow.debtAmount += chainMetricsBySaleId.get(sale.id)?.currentDebtAmount ?? (sale.remainingDebtAmount ?? 0);
        managerMap.set(sale.managerUserId, managerRow);
      }

      const saleById = new Map(nonTechnicalSales.map((sale) => [sale.id, sale]));

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
          factSalesCount: nonTechnicalSales.length,
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
