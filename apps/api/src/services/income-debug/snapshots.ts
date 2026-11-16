import type { DbClient } from '@dashboarduz/db';
import { normalizeDigits } from '@dashboarduz/shared';

import { type MatchTextOptions, normalizeMatchText } from '../../lib/text';
import type { FinanceSnapshotRow } from '../../trpc/routers/income-problems';
import { evaluateSaleChainConsistency, getSaleAgreementAmount } from '../income-chain';

const NAME_MATCH: MatchTextOptions = { collapseWhitespace: true, unifyApostrophes: true };

const LOOSE_TEXT_MATCH: MatchTextOptions = { ...NAME_MATCH, hyphensToSpaces: true };

export async function getSaleChainConsistencySnapshot(params: {
  tenantId: string;
  saleId: string;
  db: DbClient;
}) {
  const { db } = params;

  const sale = await db.income.findFirst({
    where: {
      id: params.saleId,
      tenantId: params.tenantId,
      type: 'new_sale',
      lifecycleStatus: 'active',
    },
    select: {
      id: true,
      entryDate: true,
      coursePriceAmount: true,
      debtAmount: true,
      paymentAmount: true,
    },
  });

  if (!sale) {
    return null;
  }

  const chainRows = await db.income.findMany({
    where: {
      tenantId: params.tenantId,
      lifecycleStatus: 'active',
      OR: [
        { id: sale.id },
        { relatedDebtIncomeId: sale.id },
      ],
    },
    select: {
      id: true,
      type: true,
      relatedDebtIncomeId: true,
      paymentAmount: true,
      entryDate: true,
      createdAt: true,
      debtAmount: true,
      remainingDebtAmount: true,
    },
  });

  const agreementAmount = getSaleAgreementAmount(sale);
  const consistency = evaluateSaleChainConsistency({
    saleId: sale.id,
    agreementAmount,
    chainRows,
  });

  return {
    saleId: sale.id,
    agreementAmount,
    chainRows,
    consistency,
  };
}

export function findSnapshotMatch(params: {
  income: {
    id: string;
    type: string;
    paymentAmount: number;
    remainingDebtAmount: number;
    customerNumber: string;
    customerName: string;
    managerName: string;
    courseName: string;
    tariffName: string;
  };
  snapshotRows: FinanceSnapshotRow[];
  usedRowKeys: Set<string>;
}) {
  const normalizedPhone = normalizeDigits(params.income.customerNumber);
  const normalizedNameValue = normalizeMatchText(params.income.customerName, NAME_MATCH);
  const managerNeedle = normalizeMatchText(params.income.managerName, LOOSE_TEXT_MATCH);
  const courseNeedle = normalizeMatchText(params.income.courseName, LOOSE_TEXT_MATCH);
  const tariffNeedle = normalizeMatchText(params.income.tariffName, LOOSE_TEXT_MATCH);
  const amount = Math.round(params.income.paymentAmount || 0);
  const debt = Math.round(params.income.remainingDebtAmount || 0);

  const scored = params.snapshotRows
    .filter((row) => {
      const rowKey = `${row.normalizedPhone || row.normalizedName}:${row.rowIndex}`;

      if (params.usedRowKeys.has(rowKey)) {
        return false;
      }
      const sameIdentity = normalizedPhone
        ? row.normalizedPhone === normalizedPhone
        : row.normalizedName === normalizedNameValue;

      return sameIdentity && Math.round(row.paymentAmount || 0) === amount;
    })
    .map((row) => {
      let score = 0;

      if (normalizedPhone && row.normalizedPhone === normalizedPhone) score += 100;
      if (normalizedNameValue && row.normalizedName === normalizedNameValue) score += 20;
      if (managerNeedle && normalizeMatchText(row.managerLabel, LOOSE_TEXT_MATCH) === managerNeedle) score += 15;
      const financeCourseHaystack = normalizeMatchText(`${row.courseName} ${row.tariffName} ${row.subTariffName}`, LOOSE_TEXT_MATCH);

      if (courseNeedle && financeCourseHaystack.includes(courseNeedle)) score += 10;
      if (tariffNeedle && financeCourseHaystack.includes(tariffNeedle)) score += 10;
      if (Math.round(row.remainingDebtAmount || 0) === debt) score += 5;

      return {
        row,
        score,
      };
    })
    .sort((left, right) => right.score - left.score || left.row.rowIndex - right.row.rowIndex);

  if (scored.length === 0) {
    return { status: 'no_match' as const };
  }

  const best = scored[0]!;
  const second = scored[1];

  if (second && second.score === best.score) {
    return {
      status: 'ambiguous' as const,
      candidateCount: scored.length,
      topScore: best.score,
    };
  }

  return {
    status: 'matched' as const,
    row: best.row,
    score: best.score,
  };
}
