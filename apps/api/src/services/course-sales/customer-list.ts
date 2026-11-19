import type { DbClient } from '@dashboarduz/db';

import { buildActiveSaleChainMetrics, extractSaleSubTariffId, INCOME_LIFECYCLE_ACTIVE, type SaleChainSaleRow } from '../income-chain';
import { resolveSaleAgreementAmount } from '../income-facts';

import { buildCustomerCoursesByCustomer } from './helpers';
import { activeSalesWhere, managerScopeWhere, type SaleFilter } from './queries';

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

/** `where` of the customer list: the scoped active sales, an optional entry-date window, and a name/number search. */
export function buildCustomerListWhere(params: {
  tenantId: string;
  scopedManagerUserIds?: readonly string[] | null;
  filters: SaleFilter[];
  entryDate?: { gte: Date; lte: Date };
  query?: string;
}) {
  return activeSalesWhere({
    tenantId: params.tenantId,
    scopedManagerUserIds: params.scopedManagerUserIds,
    filters: params.filters,
    extra: {
      ...(params.entryDate ? { entryDate: params.entryDate } : {}),
      ...(params.query
        ? {
            OR: [
              { customer: { customerNumber: { contains: params.query, mode: 'insensitive' as const } } },
              { customer: { name: { contains: params.query, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    },
  });
}

/**
 * One page of the course-sales customer list (by course or by course type): each sale with its customer,
 * manager, chain-derived amounts and every other active course of that customer.
 * 1 so'm (technical) sales stay in the list; the summaries count them separately as service exchange.
 */
export async function listCourseSaleCustomers(params: {
  db: DbClient;
  tenantId: string;
  scopedManagerUserIds?: readonly string[] | null;
  filters: SaleFilter[];
  entryDate?: { gte: Date; lte: Date };
  query?: string;
  page: number;
  limit: number;
}) {
  const { db, tenantId, scopedManagerUserIds } = params;
  const where = buildCustomerListWhere(params);

  const [total, sales] = await Promise.all([
    db.income.count({ where: { ...where, tenantId } }),
    db.income.findMany({
      where: { ...where, tenantId },
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      skip: (params.page - 1) * params.limit,
      take: params.limit,
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

  const customerIds = uniqueIds(sales.map((sale) => sale.customerId));
  const combinedSubTariffIds = uniqueIds([
    ...sales.map((sale) => sale.customer.profileSubTariffId),
    ...sales.map((sale) => extractSaleSubTariffId(sale.legacyImportMeta)),
  ]);
  const profileCourseIds = uniqueIds(sales.map((sale) => sale.customer.profileCourseId));
  const profileTariffIds = uniqueIds(sales.map((sale) => sale.customer.profileTariffId));
  const idName = { id: true, name: true };

  const [subTariffs, profileCourses, profileTariffs, allActiveSalesByCustomer] = await Promise.all([
    combinedSubTariffIds.length > 0
      ? db.subTariff.findMany({ where: { tenantId, id: { in: combinedSubTariffIds } }, select: idName })
      : Promise.resolve([]),
    profileCourseIds.length > 0
      ? db.course.findMany({ where: { tenantId, id: { in: profileCourseIds } }, select: idName })
      : Promise.resolve([]),
    profileTariffIds.length > 0
      ? db.tariff.findMany({ where: { tenantId, id: { in: profileTariffIds } }, select: idName })
      : Promise.resolve([]),
    customerIds.length > 0
      ? db.income.findMany({
          where: {
            tenantId,
            customerId: { in: customerIds },
            type: 'new_sale',
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            ...managerScopeWhere(scopedManagerUserIds),
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
  const chainMetricsBySaleId = await buildActiveSaleChainMetrics({ tenantId, sales, db });
  const allCustomerChainMetricsBySaleId = await buildActiveSaleChainMetrics({
    tenantId,
    sales: allActiveSalesByCustomer as SaleChainSaleRow[],
    db,
  });
  const customerCoursesByCustomer = buildCustomerCoursesByCustomer(
    allActiveSalesByCustomer,
    subTariffNameById,
    allCustomerChainMetricsBySaleId,
  );

  return {
    page: params.page,
    limit: params.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.limit)),
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
}

/** The empty page returned when a course type has no active courses. */
export function emptyCustomerPage(page: number, limit: number) {
  return { page, limit, total: 0, totalPages: 1, rows: [] as Awaited<ReturnType<typeof listCourseSaleCustomers>>['rows'] };
}
