import type { DbClient } from '@dashboarduz/db';
import { formatSomAmount } from '@dashboarduz/shared';

import { INCOME_LIFECYCLE_ACTIVE } from '../income-chain';
import { excludeTechnicalRows, loadTechnicalSaleIdsForRows, resolveSaleAgreementAmount } from '../income-facts';

type CourseHintSummary = {
  requestedToken: string;
  matchedCourseName: string | null;
  similarity: number;
  salesCount: number;
  agreementAmount: number;
  incomeAmount: number;
  debtAmount: number;
  tariffBreakdown: Array<{
    tariff: string;
    salesCount: number;
    agreementAmount: number;
    incomeAmount: number;
    debtAmount: number;
  }>;
};

function normalizeLooseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/['`"]/g, '')
    .replace(/o‘|o'/g, 'o')
    .replace(/g‘|g'/g, 'g')
    .replace(/sh/g, 's_h')
    .replace(/ch/g, 'c_h')
    .replace(/[^a-z0-9]+/g, '')
    .replace(/s_h/g, 'sh')
    .replace(/c_h/g, 'ch')
    .trim();
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  // Both rows have b.length + 1 cells and every index below stays in range; `?? 0` only satisfies the checker.
  const v0 = new Array<number>(b.length + 1).fill(0);
  const v1 = new Array<number>(b.length + 1).fill(0);

  for (let i = 0; i <= b.length; i += 1) v0[i] = i;
  for (let i = 0; i < a.length; i += 1) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;

      v1[j + 1] = Math.min(
        (v1[j] ?? 0) + 1,
        (v0[j + 1] ?? 0) + 1,
        (v0[j] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) v0[j] = v1[j] ?? 0;
  }

  return v1[b.length] ?? 0;
}

export function similarityScore(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);

  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a, b);

  return Math.max(0, 1 - dist / maxLen);
}

function extractLikelyCourseToken(message: string): string | null {
  const text = message.toLowerCase();
  const courseRegex = /(\d+\s*-?\s*[a-zа-яo'g`'‘]+(?:\s*[a-zа-яo'g`'‘]+)?)/i;
  const match = text.match(courseRegex);
  const token = (match?.[1] || '').trim();

  if (token.length >= 3) {
    return token;
  }
  if (text.includes('kurs') || text.includes('tarif') || text.includes('coching') || text.includes('couching')) {
    return text.trim().slice(0, 64);
  }

  return null;
}

export function shouldPreferCourseDirectAnswer(message: string): boolean {
  const text = message.toLowerCase();

  return (
    text.includes('kurs')
    || text.includes('coching')
    || text.includes('couching')
    || text.includes('sotuv')
    || text.includes('tarif')
  );
}

export function buildCourseDirectAnswer(courseHint: CourseHintSummary): string {
  const tariffParts = courseHint.tariffBreakdown
    .filter((item) => item.salesCount > 0)
    .map((item) => `${item.tariff} - ${item.salesCount} ta`);
  const tariffLine = tariffParts.length > 0
    ? tariffParts.join(', ')
    : "tariflar bo'yicha sotuv topilmadi";

  return [
    `${courseHint.matchedCourseName}ga ${courseHint.salesCount} ta sotuv bo'lgan.`,
    `Tariflar: ${tariffLine}.`,
    `Kelishuv summasi: ${formatSomAmount(courseHint.agreementAmount)}.`,
    `To'langan summasi: ${formatSomAmount(courseHint.incomeAmount)}.`,
    `Qarzdorlik summasi: ${formatSomAmount(courseHint.debtAmount)}.`,
  ].join(' ');
}

export function buildCourseSuggestionAnswer(courseHint: CourseHintSummary): string | null {
  if (!courseHint.matchedCourseName || courseHint.similarity < 0.45) {
    return null;
  }

  return `Savolda yozuv xatolik bo'lishi mumkin. Balki "${courseHint.matchedCourseName}" ni nazarda tutdingizmi?`;
}

export async function buildCourseHintSummary(
  tenantId: string,
  rangeStart: Date,
  rangeEnd: Date,
  message: string,
  db: DbClient,
): Promise<CourseHintSummary | null> {
  const requestedToken = extractLikelyCourseToken(message);

  if (!requestedToken) {
    return null;
  }

  const courses = await db.course.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true },
  });

  if (!courses.length) {
    return null;
  }

  const normalizedRequested = normalizeLooseText(requestedToken);
  let best: { id: string; name: string; score: number } | null = null;

  for (const course of courses) {
    const normalizedCourse = normalizeLooseText(course.name || '');

    if (!normalizedCourse) continue;
    const score = similarityScore(normalizedRequested, normalizedCourse);

    if (!best || score > best.score) {
      best = { id: course.id, name: course.name, score };
    }
  }

  if (!best || best.score < 0.55) {
    return {
      requestedToken,
      matchedCourseName: null,
      similarity: best?.score || 0,
      salesCount: 0,
      agreementAmount: 0,
      incomeAmount: 0,
      debtAmount: 0,
      tariffBreakdown: [],
    };
  }

  const salesRaw = await db.income.findMany({
    where: {
      tenantId,
      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      type: 'new_sale',
      courseId: best.id,
      entryDate: { gte: rangeStart, lte: rangeEnd },
    },
    select: {
      id: true,
      type: true,
      relatedDebtIncomeId: true,
      paymentAmount: true,
      coursePriceAmount: true,
      debtAmount: true,
      remainingDebtAmount: true,
      tariff: { select: { name: true } },
    },
  });

  const repaymentsRaw = await db.income.findMany({
    where: {
      tenantId,
      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      type: 'repayment',
      courseId: best.id,
      entryDate: { gte: rangeStart, lte: rangeEnd },
    },
    select: {
      id: true,
      type: true,
      relatedDebtIncomeId: true,
      paymentAmount: true,
      tariff: { select: { name: true } },
    },
  });

  // Technical sales (agreement == 1) and their repayments are not real sales.
  const technicalSaleIds = await loadTechnicalSaleIdsForRows(tenantId, [...salesRaw, ...repaymentsRaw], db);
  const sales = excludeTechnicalRows(salesRaw, technicalSaleIds);
  const repayments = excludeTechnicalRows(repaymentsRaw, technicalSaleIds);

  const tariffMap = new Map<string, { salesCount: number; agreementAmount: number; incomeAmount: number; debtAmount: number }>();

  for (const sale of sales) {
    const key = sale.tariff?.name || 'Tarifsiz';
    const row = tariffMap.get(key) || { salesCount: 0, agreementAmount: 0, incomeAmount: 0, debtAmount: 0 };

    row.salesCount += 1;
    row.agreementAmount += resolveSaleAgreementAmount(sale);
    row.incomeAmount += Number(sale.paymentAmount || 0);
    row.debtAmount += Math.max(0, Number(sale.remainingDebtAmount || 0));
    tariffMap.set(key, row);
  }
  for (const repayment of repayments) {
    const key = repayment.tariff?.name || 'Tarifsiz';
    const row = tariffMap.get(key) || { salesCount: 0, agreementAmount: 0, incomeAmount: 0, debtAmount: 0 };

    row.incomeAmount += Number(repayment.paymentAmount || 0);
    tariffMap.set(key, row);
  }

  const agreementAmount = sales.reduce((sum, row) => sum + resolveSaleAgreementAmount(row), 0);
  const incomeAmount = sales.reduce((sum, row) => sum + Number(row.paymentAmount || 0), 0)
    + repayments.reduce((sum, row) => sum + Number(row.paymentAmount || 0), 0);
  const debtAmount = sales.reduce((sum, row) => sum + Math.max(0, Number(row.remainingDebtAmount || 0)), 0);

  return {
    requestedToken,
    matchedCourseName: best.name,
    similarity: Number(best.score.toFixed(3)),
    salesCount: sales.length,
    agreementAmount,
    incomeAmount,
    debtAmount,
    tariffBreakdown: Array.from(tariffMap.entries())
      .map(([tariff, metrics]) => ({ tariff, ...metrics }))
      .sort((a, b) => b.salesCount - a.salesCount),
  };
}
