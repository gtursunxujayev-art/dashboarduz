import { type DbClient, systemPrisma } from '@dashboarduz/db';

import type { SalaryCategory } from '../../trpc/routers/dashboard/helpers';
import { buildTechnicalSaleIdSet } from '../technical-income';

import { amount, getCategory } from './policy';
import type { IncomeRow } from './types';

export function resolveFullyPaidClosure(sale: Pick<IncomeRow, 'coursePriceAmount' | 'debtAmount'>, chain: IncomeRow[]): {
  closing: IncomeRow;
  agreementAmount: number;
} | null {
  // Without a known agreement a sale cannot be "fully paid": falling back to the running total would make the
  // last payment of every month look like a closure and pay bonus on the same sale more than once.
  const agreementAmount = amount(sale.coursePriceAmount ?? sale.debtAmount);

  if (agreementAmount <= 0) return null;
  let paid = 0;

  for (const row of chain) {
    paid += amount(row.paymentAmount);
    if (paid >= agreementAmount) return { closing: row, agreementAmount };
  }

  return null;
}

export type SaleClosure = {
  saleId: string;
  closingIncomeId: string;
  /** Agent who recorded the closing payment; closures are credited to them. */
  closerUserId: string;
  sellerUserId: string;
  closedAt: Date;
  agreementAmount: number;
  category: SalaryCategory;
  courseId: string | null;
  tariffId: string | null;
  profileSubTariffId: string | null;
};

/**
 * Every non-technical active sale that became fully paid on or before `rangeEnd`, with the payment that closed it.
 * Uses the same closure rule as the bonus engine, so plan bonus and bonus counts can never disagree.
 */
export async function loadSaleClosures(params: { tenantId: string; rangeEnd: Date; db?: DbClient }): Promise<SaleClosure[]> {
  const db = params.db ?? systemPrisma;
  const rows = await db.income.findMany({
    where: { tenantId: params.tenantId, lifecycleStatus: 'active', entryDate: { lte: params.rangeEnd } },
    select: {
      id: true, type: true, relatedDebtIncomeId: true, managerUserId: true,
      courseId: true, tariffId: true, coursePriceAmount: true, debtAmount: true, paymentAmount: true,
      entryDate: true, createdAt: true,
      course: { select: { id: true, name: true, category: true } },
      customer: { select: { profileSubTariffId: true } },
    },
    orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  const sales = rows.filter((row) => row.type === 'new_sale');
  const technicalSaleIds = buildTechnicalSaleIdSet(sales);
  const saleById = new Map(sales.filter((sale) => !technicalSaleIds.has(sale.id)).map((sale) => [sale.id, sale]));
  const chainBySaleId = new Map<string, typeof rows>();

  for (const row of rows) {
    const saleId = row.type === 'new_sale' ? row.id : row.relatedDebtIncomeId;

    if (!saleId || !saleById.has(saleId)) continue;
    const chain = chainBySaleId.get(saleId) || [];

    chain.push(row);
    chainBySaleId.set(saleId, chain);
  }
  const closures: SaleClosure[] = [];

  for (const [saleId, chain] of chainBySaleId) {
    const sale = saleById.get(saleId)!;
    const category = getCategory(sale as unknown as IncomeRow);

    if (!category) continue;
    const closure = resolveFullyPaidClosure(sale, chain as unknown as IncomeRow[]);

    if (!closure) continue;
    closures.push({
      saleId,
      closingIncomeId: closure.closing.id,
      closerUserId: closure.closing.managerUserId,
      sellerUserId: sale.managerUserId,
      closedAt: closure.closing.entryDate,
      agreementAmount: closure.agreementAmount,
      category,
      courseId: sale.courseId,
      tariffId: sale.tariffId,
      profileSubTariffId: sale.customer?.profileSubTariffId ?? null,
    });
  }

  return closures;
}
