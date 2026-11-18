/**
 * Money side of the Telegram report: income totals, new sales by course category, sales per manager,
 * and the per-tariff sales of the courses picked for the report. Pure functions over income rows.
 */
import { classifyIncomeCategory, resolveSaleAgreementAmount } from '../../income-facts';

import type { ReportMetrics } from './types';

/** An income row as the report reads it (technical sales already removed). */
export type ReportIncomeRow = {
  type: string;
  managerUserId: string;
  paymentAmount: number;
  coursePriceAmount: number | null;
  debtAmount: number | null;
  course: { category: string | null; name: string | null } | null;
};

export type ManagerSalesStats = { sales: number; agreementAmount: number; incomeAmount: number };

export type ReportSalesTotals = Pick<
  ReportMetrics,
  | 'incomeTotal'
  | 'newSalesCount'
  | 'agreementTotal'
  | 'newSalesIncomeTotal'
  | 'debtRepaymentIncomeTotal'
  | 'onlineSalesCount'
  | 'onlineAgreementTotal'
  | 'offlineSalesCount'
  | 'offlineAgreementTotal'
  | 'intensiveSalesCount'
  | 'intensiveAgreementTotal'
>;

const NO_TARIFF_LABEL = "Tarif yo'q";

function emptySalesTotals(): ReportSalesTotals {
  return {
    incomeTotal: 0,
    newSalesCount: 0,
    agreementTotal: 0,
    newSalesIncomeTotal: 0,
    debtRepaymentIncomeTotal: 0,
    onlineSalesCount: 0,
    onlineAgreementTotal: 0,
    offlineSalesCount: 0,
    offlineAgreementTotal: 0,
    intensiveSalesCount: 0,
    intensiveAgreementTotal: 0,
  };
}

/** Adds a new sale's agreement to its course category (online / offline / intensive; others are not split out). */
function addCategorySale(totals: ReportSalesTotals, income: ReportIncomeRow, agreementAmount: number): void {
  const category = classifyIncomeCategory(income.course);

  if (category === 'online') {
    totals.onlineSalesCount += 1;
    totals.onlineAgreementTotal += agreementAmount;
  } else if (category === 'offline') {
    totals.offlineSalesCount += 1;
    totals.offlineAgreementTotal += agreementAmount;
  } else if (category === 'intensive') {
    totals.intensiveSalesCount += 1;
    totals.intensiveAgreementTotal += agreementAmount;
  }
}

/**
 * Totals over the period's income rows, and per manager (in first-seen order): every payment counts as
 * income; new sales also count as a sale with their agreement amount.
 */
export function tallyReportIncomes(incomes: ReportIncomeRow[]): {
  totals: ReportSalesTotals;
  managerSalesByUserId: Map<string, ManagerSalesStats>;
} {
  const totals = emptySalesTotals();
  const managerSalesByUserId = new Map<string, ManagerSalesStats>();

  for (const income of incomes) {
    const paymentAmount = Number(income.paymentAmount || 0);
    const managerStats = managerSalesByUserId.get(income.managerUserId) || { sales: 0, agreementAmount: 0, incomeAmount: 0 };

    totals.incomeTotal += paymentAmount;
    managerStats.incomeAmount += paymentAmount;
    managerSalesByUserId.set(income.managerUserId, managerStats);

    // "Yangi tushum" = first payments of new sales; every repayment is "qarzdorlik tushumi".
    // Same definition as the Telegram group summary.
    if (income.type !== 'new_sale') {
      totals.debtRepaymentIncomeTotal += paymentAmount;
      continue;
    }

    const agreementAmount = resolveSaleAgreementAmount(income);

    totals.newSalesIncomeTotal += paymentAmount;
    totals.newSalesCount += 1;
    totals.agreementTotal += agreementAmount;
    managerStats.sales += 1;
    managerStats.agreementAmount += agreementAmount;
    addCategorySale(totals, income, agreementAmount);
  }

  return { totals, managerSalesByUserId };
}

/**
 * One row per selected course that exists (in the selection order): its new sales and their tariffs, most
 * sold first (ties by name). Sales of other courses are ignored.
 */
export function buildSelectedCourseRows(
  selectedCourseIds: string[],
  courses: Array<{ id: string; name: string }>,
  sales: Array<{ courseId: string | null; tariff: { name: string } | null }>,
): ReportMetrics['selectedCourseRows'] {
  const coursesById = new Map(courses.map((course) => [course.id, course]));
  const tariffCountsByCourseId = new Map(courses.map((course) => [course.id, new Map<string, number>()]));
  const salesCountByCourseId = new Map<string, number>();

  for (const sale of sales) {
    const tariffCounts = sale.courseId ? tariffCountsByCourseId.get(sale.courseId) : undefined;

    if (!sale.courseId || !tariffCounts) {
      continue;
    }
    const tariffName = String(sale.tariff?.name || NO_TARIFF_LABEL).trim() || NO_TARIFF_LABEL;

    salesCountByCourseId.set(sale.courseId, (salesCountByCourseId.get(sale.courseId) || 0) + 1);
    tariffCounts.set(tariffName, (tariffCounts.get(tariffName) || 0) + 1);
  }

  return selectedCourseIds.flatMap((courseId) => {
    const course = coursesById.get(courseId);

    if (!course) {
      return [];
    }

    return [{
      courseId,
      courseName: course.name,
      salesCount: salesCountByCourseId.get(courseId) || 0,
      tariffBreakdown: Array.from(tariffCountsByCourseId.get(courseId) || new Map<string, number>(), ([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
    }];
  });
}
