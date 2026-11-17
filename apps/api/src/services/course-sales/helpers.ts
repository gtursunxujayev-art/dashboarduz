import type { DbClient } from '@dashboarduz/db';

import { extractSaleSubTariffId } from '../income-chain';
import { resolveSaleSubTariffId } from '../income-facts';
import { resolveEffectiveAgreementAmount } from '../technical-income';

export async function findSaleIdsBySubTariff(
  tenantId: string,
  subTariffId: string,
  filters: Record<string, unknown>[],
  db: DbClient,
): Promise<string[]> {
  const candidates = await db.income.findMany({
    where: { tenantId, type: 'new_sale', ...(filters.length ? { AND: filters } : {}) },
    select: {
      id: true,
      courseId: true,
      tariffId: true,
      legacyImportMeta: true,
      customer: { select: { profileCourseId: true, profileTariffId: true, profileSubTariffId: true } },
    },
  });

  return candidates.filter((sale) => resolveSaleSubTariffId(sale) === subTariffId).map((sale) => sale.id);
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

export function buildCustomerCoursesByCustomer(
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

export function buildTechnicalSaleIdSetByAgreement(params: {
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
    if (sale.type && sale.type !== 'new_sale') {
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
