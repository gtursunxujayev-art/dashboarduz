import { prisma } from '@dashboarduz/db';
import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { hasAgentRole } from '@dashboarduz/shared';
import { protectedProcedure, router } from '../trpc';
import { buildSaleChainMetricsBySaleId, type SaleChainSaleRow } from '../../services/income-chain';
import {
  computeResponseMinutes,
  resolvePersonLabel,
  resolveRootSaleId,
  selectDebtorSales,
} from '../../services/reports/report-rows';
import { buildTechnicalSaleIdSetByAgreement } from './course-sales';
import { getAdjustmentRoleScope } from './customer-income';
import { parseCustomDate } from './dashboard/helpers';

const REPORT_ROW_LIMIT = 20_000;
const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'TeamLeader', 'Finance']);
const CHAIN_LIFECYCLES_ALL = ['active', 'pending_refund', 'refunded'];

const reportFiltersSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  managerUserId: z.string().optional(),
  courseId: z.string().optional(),
  tariffId: z.string().optional(),
});

type ReportFilters = z.infer<typeof reportFiltersSchema>;

function isAgentOnly(roles: string[]): boolean {
  return hasAgentRole(roles) && !roles.some((role) => PRIVILEGED_ROLES.has(role));
}

function buildDateRange(filters: ReportFilters): Prisma.DateTimeFilter | undefined {
  const range: Prisma.DateTimeFilter = {};
  if (filters.dateFrom) range.gte = parseCustomDate(filters.dateFrom, false);
  if (filters.dateTo) range.lte = parseCustomDate(filters.dateTo, true);
  return range.gte || range.lte ? range : undefined;
}

async function loadChainMetrics(tenantId: string, sales: SaleChainSaleRow[], lifecycleStatuses: string[]) {
  if (!sales.length) {
    return buildSaleChainMetricsBySaleId({ sales: [], chainRows: [] });
  }
  const saleIds = sales.map((sale) => sale.id);
  const chainRows = await prisma.income.findMany({
    where: {
      tenantId,
      lifecycleStatus: { in: lifecycleStatuses },
      OR: [{ id: { in: saleIds } }, { relatedDebtIncomeId: { in: saleIds } }],
    },
    select: { id: true, relatedDebtIncomeId: true, paymentAmount: true, entryDate: true },
  });
  return buildSaleChainMetricsBySaleId({ sales, chainRows });
}

const courseSelect = { select: { id: true, name: true } } as const;

export const reportsRouter = router({
  access: protectedProcedure.query(({ ctx }) => {
    const scope = getAdjustmentRoleScope(ctx.user.roles);
    return {
      canSeeRefunds: !scope.typeGuard || scope.typeGuard === 'refund',
      canSeeTariffChanges: !scope.typeGuard || scope.typeGuard === 'tariff_change',
    };
  }),

  filterOptions: protectedProcedure.query(async ({ ctx }) => {
    const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : null;
    const [managers, courses] = await Promise.all([
      prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(scopedManagerUserId
            ? { id: scopedManagerUserId }
            : { managedIncomes: { some: { type: 'new_sale' } } }),
        },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, username: true },
      }),
      prisma.course.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          tariffs: { orderBy: { name: 'asc' }, select: { id: true, name: true } },
        },
      }),
    ]);
    return {
      managers: managers.map((manager) => ({ id: manager.id, label: resolvePersonLabel(manager) })),
      courses,
    };
  }),

  debtors: protectedProcedure
    .input(reportFiltersSchema.optional())
    .query(async ({ ctx, input }) => {
      const filters = input ?? {};
      const entryDate = buildDateRange(filters);
      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : null;

      const sales = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: 'active',
          ...(scopedManagerUserId
            ? { managerUserId: scopedManagerUserId }
            : (filters.managerUserId ? { managerUserId: filters.managerUserId } : {})),
          ...(filters.courseId ? { courseId: filters.courseId } : {}),
          ...(filters.tariffId ? { tariffId: filters.tariffId } : {}),
          ...(entryDate ? { entryDate } : {}),
        },
        orderBy: { entryDate: 'desc' },
        take: REPORT_ROW_LIMIT,
        select: {
          id: true,
          type: true,
          entryDate: true,
          coursePriceAmount: true,
          debtAmount: true,
          paymentAmount: true,
          remainingDebtAmount: true,
          customer: { select: { customerNumber: true, name: true } },
          manager: { select: { id: true, name: true, username: true } },
          course: courseSelect,
          tariff: courseSelect,
        },
      });

      const chainMetricsBySaleId = await loadChainMetrics(ctx.tenantId, sales, ['active']);
      const technicalSaleIds = buildTechnicalSaleIdSetByAgreement({ sales, chainMetricsBySaleId });

      return selectDebtorSales({ sales, chainMetricsBySaleId, technicalSaleIds }).map((row) => ({
        saleId: row.sale.id,
        customerNumber: row.sale.customer?.customerNumber ?? '',
        customerName: row.sale.customer?.name ?? '',
        managerLabel: resolvePersonLabel(row.sale.manager),
        courseName: row.sale.course?.name ?? null,
        tariffName: row.sale.tariff?.name ?? null,
        firstPaymentDate: row.sale.entryDate,
        lastPaymentDate: row.lastActivityAt,
        agreementAmount: row.agreementAmount,
        paidAmount: row.paidAmount,
        debtAmount: row.debtAmount,
      }));
    }),

  adjustments: protectedProcedure
    .input(reportFiltersSchema.extend({
      type: z.enum(['refund', 'tariff_change']),
      status: z.enum(['pending', 'approved', 'rejected']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const scope = getAdjustmentRoleScope(ctx.user.roles);
      if (scope.typeGuard && scope.typeGuard !== input.type) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this request type.' });
      }

      const createdAt = buildDateRange(input);
      const and: Prisma.IncomeAdjustmentRequestWhereInput[] = [];
      if (!scope.canSeeAll) {
        and.push({
          OR: [
            { requestedByUserId: ctx.user.userId },
            { income: { managerUserId: ctx.user.userId } },
          ],
        });
      }
      if (input.managerUserId) {
        and.push({ income: { managerUserId: input.managerUserId } });
      }
      // Filter by the source course: the stored snapshot, or the income's course when no snapshot exists.
      if (input.courseId) {
        and.push({ OR: [{ previousCourseId: input.courseId }, { previousCourseId: null, income: { courseId: input.courseId } }] });
      }
      if (input.tariffId) {
        and.push({ OR: [{ previousTariffId: input.tariffId }, { previousTariffId: null, income: { tariffId: input.tariffId } }] });
      }

      const saleFields = {
        id: true,
        type: true,
        entryDate: true,
        relatedDebtIncomeId: true,
        coursePriceAmount: true,
        debtAmount: true,
        paymentAmount: true,
        remainingDebtAmount: true,
        course: courseSelect,
        tariff: courseSelect,
      } as const;

      const requests = await prisma.incomeAdjustmentRequest.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: input.type,
          ...(input.status ? { status: input.status } : {}),
          ...(createdAt ? { createdAt } : {}),
          ...(and.length ? { AND: and } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: REPORT_ROW_LIMIT,
        select: {
          id: true,
          status: true,
          reason: true,
          reviewNote: true,
          requestedAmount: true,
          newAgreementAmount: true,
          createdAt: true,
          reviewedAt: true,
          requestedBy: { select: { id: true, name: true, username: true } },
          reviewedBy: { select: { id: true, name: true, username: true } },
          newCourse: courseSelect,
          newTariff: courseSelect,
          previousCourse: courseSelect,
          previousTariff: courseSelect,
          income: {
            select: {
              ...saleFields,
              customer: { select: { customerNumber: true, name: true } },
              manager: { select: { id: true, name: true, username: true } },
              relatedDebtIncome: { select: saleFields },
            },
          },
        },
      });

      const rootSaleById = new Map<string, SaleChainSaleRow & { course: { name: string } | null; tariff: { name: string } | null }>();
      for (const request of requests) {
        const rootSale = request.income.type === 'repayment' && request.income.relatedDebtIncome
          ? request.income.relatedDebtIncome
          : request.income;
        rootSaleById.set(resolveRootSaleId(request.income), rootSale);
      }
      const chainMetricsBySaleId = await loadChainMetrics(ctx.tenantId, [...rootSaleById.values()], CHAIN_LIFECYCLES_ALL);

      return requests.map((request) => {
        const rootSaleId = resolveRootSaleId(request.income);
        const rootSale = rootSaleById.get(rootSaleId);
        const metric = chainMetricsBySaleId.get(rootSaleId);
        const hasSnapshot = Boolean(request.previousCourse || request.previousTariff);
        // Approved tariff changes overwrite the income's course, so it is only a valid source when not yet applied.
        const sourceKnown = hasSnapshot || input.type === 'refund' || request.status !== 'approved';
        return {
          id: request.id,
          status: request.status,
          requestDate: request.createdAt,
          reviewedAt: request.reviewedAt,
          responseMinutes: computeResponseMinutes(request.createdAt, request.reviewedAt),
          requestedByLabel: resolvePersonLabel(request.requestedBy),
          reviewedByLabel: request.reviewedBy ? resolvePersonLabel(request.reviewedBy) : null,
          customerNumber: request.income.customer?.customerNumber ?? '',
          customerName: request.income.customer?.name ?? '',
          managerLabel: resolvePersonLabel(request.income.manager),
          firstPaymentDate: rootSale?.entryDate ?? request.income.entryDate,
          fromCourseName: hasSnapshot ? request.previousCourse?.name ?? null : (sourceKnown ? rootSale?.course?.name ?? null : null),
          fromTariffName: hasSnapshot ? request.previousTariff?.name ?? null : (sourceKnown ? rootSale?.tariff?.name ?? null : null),
          toCourseName: request.newCourse?.name ?? null,
          toTariffName: request.newTariff?.name ?? null,
          agreementAmount: metric?.agreementAmount ?? 0,
          newAgreementAmount: request.newAgreementAmount,
          paidAmount: metric?.paidAmount ?? 0,
          debtAmount: metric?.currentDebtAmount ?? 0,
          requestedAmount: request.requestedAmount,
          reason: request.reason,
          reviewNote: request.reviewNote,
        };
      });
    }),
});
