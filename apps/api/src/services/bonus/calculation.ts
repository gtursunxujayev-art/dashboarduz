import { createHash } from 'node:crypto';

import { type DbClient, systemPrisma } from '@dashboarduz/db';

import { resolveBonusPercent, type SalaryCategory } from '../../trpc/routers/dashboard/helpers';
import { buildTechnicalSaleIdSet } from '../technical-income';

import { resolveFullyPaidClosure } from './closures';
import { amount, getCategory, getTashkentMonthEnd, getTashkentMonthStart, resolveCourseIncomePercent, resolveEffectiveBonusPolicy } from './policy';
import { type BonusCalculationItem, type BonusCalculationLine, type BonusMonthCalculation, type BonusPolicy, ELIGIBLE_ROLES, type IncomeRow } from './types';

function allocateRoundedGroup(items: BonusCalculationItem[], percent: number): void {
  const exact = items.map((item) => item.baseAmount * percent / 100);
  const target = Math.round(exact.reduce((sum, value) => sum + value, 0));
  const floors = exact.map(Math.floor);
  let remainder = target - floors.reduce((sum, value) => sum + value, 0);
  const order = items.map((item, index) => ({
    index,
    fraction: exact[index]! - floors[index]!,
    event: item.eventDate.getTime(),
    key: item.sourceKey,
  })).sort((left, right) => (
    right.fraction - left.fraction || left.event - right.event || left.key.localeCompare(right.key)
  ));

  for (const candidate of order) {
    if (remainder <= 0) break;
    floors[candidate.index] = (floors[candidate.index] || 0) + 1;
    remainder -= 1;
  }
  items.forEach((item, index) => {
    item.appliedPercent = percent;
    item.bonusAmount = floors[index] || 0;
  });
}

function buildLines(items: BonusCalculationItem[]): BonusCalculationLine[] {
  const lines = new Map<string, BonusCalculationLine>();

  for (const item of items) {
    const groupKey = `${item.agentUserId}:${item.courseId || 'none'}:${item.category}:${item.calculationMode}`;
    const current = lines.get(groupKey) || {
      groupKey,
      agentUserId: item.agentUserId,
      courseId: item.courseId,
      category: item.category,
      calculationMode: item.calculationMode,
      qualifyingAmount: 0,
      appliedPercent: item.appliedPercent,
      bonusAmount: 0,
      sourceCount: 0,
    };

    current.qualifyingAmount += item.baseAmount;
    current.bonusAmount += item.bonusAmount;
    current.sourceCount += 1;
    current.appliedPercent = item.appliedPercent;
    lines.set(groupKey, current);
  }

  return [...lines.values()].sort((left, right) => left.groupKey.localeCompare(right.groupKey));
}

function legacyDigestRows(rows: IncomeRow[], policy: BonusPolicy): string {
  const payload = rows.map((row) => [
    row.id, row.type, row.relatedDebtIncomeId, row.managerUserId, row.courseId,
    row.coursePriceAmount, row.paymentAmount, row.entryDate.toISOString(),
  ]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));

  return createHash('sha256').update(JSON.stringify({ policy, payload })).digest('hex');
}

// Every input the calculation reads must be in the digest, otherwise reconcile never notices the change.
function digestRows(rows: IncomeRow[], policy: BonusPolicy): string {
  const payload = rows.map((row) => [
    row.id, row.type, row.relatedDebtIncomeId, row.managerUserId, row.courseId,
    row.coursePriceAmount, row.debtAmount, row.paymentAmount, row.entryDate.toISOString(),
    row.course?.category ?? null, row.course?.name ?? null,
  ]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));

  return createHash('sha256').update(JSON.stringify({ v: 2, policy, payload })).digest('hex');
}

export async function calculateBonusMonth(params: {
  tenantId: string;
  month: Date;
  policy?: BonusPolicy;
  policyVersionId?: string | null;
  db?: DbClient;
}): Promise<BonusMonthCalculation> {
  const db = params.db ?? systemPrisma;
  const month = getTashkentMonthStart(params.month);
  const monthEnd = getTashkentMonthEnd(month);
  const resolved = params.policy
    ? { policy: params.policy, policyVersionId: params.policyVersionId ?? null }
    : await resolveEffectiveBonusPolicy(params.tenantId, month, db);
  const [users, rows] = await Promise.all([
    db.user.findMany({
      where: { tenantId: params.tenantId, isActive: true, roles: { hasSome: [...ELIGIBLE_ROLES] } },
      select: { id: true, roles: true },
    }),
    db.income.findMany({
      where: { tenantId: params.tenantId, lifecycleStatus: 'active', entryDate: { lte: monthEnd } },
      select: {
        id: true, type: true, relatedDebtIncomeId: true, managerUserId: true,
        courseId: true, coursePriceAmount: true, debtAmount: true, paymentAmount: true,
        remainingDebtAmount: true, entryDate: true, createdAt: true,
        course: { select: { id: true, name: true, category: true } },
      },
      orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const eligibleAgentIds = new Set(users.filter((user) => user.roles.some((role) => ELIGIBLE_ROLES.has(role))).map((user) => user.id));
  const sales = (rows as IncomeRow[]).filter((row) => row.type === 'new_sale');
  const technicalSaleIds = buildTechnicalSaleIdSet(sales);
  const saleById = new Map(sales.filter((sale) => !technicalSaleIds.has(sale.id)).map((sale) => [sale.id, sale]));
  const chainBySaleId = new Map<string, IncomeRow[]>();

  for (const row of rows as IncomeRow[]) {
    const saleId = row.type === 'new_sale' ? row.id : row.relatedDebtIncomeId;

    if (!saleId || technicalSaleIds.has(saleId) || !saleById.has(saleId)) continue;
    const chain = chainBySaleId.get(saleId) || [];

    chain.push(row);
    chainBySaleId.set(saleId, chain);
  }

  const closures: Array<{ sale: IncomeRow; closing: IncomeRow; agreementAmount: number; category: SalaryCategory }> = [];
  const closedCounts = new Map<string, number>();

  for (const [saleId, chain] of chainBySaleId) {
    const sale = saleById.get(saleId)!;
    const category = getCategory(sale);

    if (!category) continue;
    const resolvedClosure = resolveFullyPaidClosure(sale, chain);

    if (!resolvedClosure || resolvedClosure.closing.entryDate < month || resolvedClosure.closing.entryDate > monthEnd) continue;
    closures.push({ sale, closing: resolvedClosure.closing, agreementAmount: resolvedClosure.agreementAmount, category });
    // A closure is credited to the agent who recorded the closing payment (the "closer"), on every screen.
    const legacyKey = `${resolvedClosure.closing.managerUserId}:${category}`;

    closedCounts.set(legacyKey, (closedCounts.get(legacyKey) || 0) + 1);
  }

  const teamAmountByCourse = new Map<string, number>();

  for (const closure of closures) {
    if (!closure.sale.courseId || !resolved.policy.courseOverrides[closure.sale.courseId]) continue;
    if (!eligibleAgentIds.has(closure.closing.managerUserId)) continue;
    teamAmountByCourse.set(
      closure.sale.courseId,
      (teamAmountByCourse.get(closure.sale.courseId) || 0) + closure.agreementAmount,
    );
  }

  const items: BonusCalculationItem[] = [];

  if (resolved.policy.bonusMode === 'on_income') {
    for (const row of rows as IncomeRow[]) {
      if (row.entryDate < month || row.entryDate > monthEnd || !eligibleAgentIds.has(row.managerUserId)) continue;
      const sale = row.type === 'new_sale' ? saleById.get(row.id) : saleById.get(row.relatedDebtIncomeId || '');

      if (!sale || (sale.courseId && resolved.policy.courseOverrides[sale.courseId])) continue;
      const category = getCategory(sale);

      if (!category) continue;
      const closedCount = closedCounts.get(`${row.managerUserId}:${category}`) || 0;
      const rule = resolved.policy.bonusRules[category];
      const appliedPercent = resolveBonusPercent(rule, closedCount);
      const baseAmount = amount(row.paymentAmount);

      items.push({
        sourceKey: `income:${row.id}`,
        sourceIncomeId: row.id,
        sourceSaleId: sale.id,
        agentUserId: row.managerUserId,
        courseId: sale.courseId,
        courseName: sale.course?.name || null,
        category,
        calculationMode: 'legacy_income',
        eventDate: row.entryDate,
        baseAmount,
        appliedPercent,
        bonusAmount: Math.round(baseAmount * appliedPercent / 100),
        agreementAmount: amount(sale.coursePriceAmount ?? sale.debtAmount) || baseAmount,
        closingIncomeId: row.id,
        closedCount,
        usedFallback: rule.mode === 'tiered' && !rule.tiers.some((tier) => closedCount >= tier.minSales && (tier.maxSales === null || closedCount <= tier.maxSales)),
      });
    }
  }

  const courseOverrideGroups = new Map<string, BonusCalculationItem[]>();

  for (const closure of closures) {
    const courseId = closure.sale.courseId;
    const override = courseId ? resolved.policy.courseOverrides[courseId] : null;

    if (override) {
      if (!eligibleAgentIds.has(closure.closing.managerUserId)) continue;
      const result = resolveCourseIncomePercent(override, teamAmountByCourse.get(courseId!) || 0);
      const item: BonusCalculationItem = {
        sourceKey: `course-close:${closure.closing.id}`,
        sourceIncomeId: closure.closing.id,
        sourceSaleId: closure.sale.id,
        agentUserId: closure.closing.managerUserId,
        courseId,
        courseName: closure.sale.course?.name || null,
        category: closure.category,
        calculationMode: 'course_team_income',
        eventDate: closure.closing.entryDate,
        baseAmount: closure.agreementAmount,
        appliedPercent: result.percent,
        bonusAmount: 0,
        agreementAmount: closure.agreementAmount,
        closingIncomeId: closure.closing.id,
        closedCount: closures.filter((candidate) => candidate.sale.courseId === courseId).length,
        usedFallback: result.usedFallback,
      };
      const key = `${item.agentUserId}:${courseId}`;
      const group = courseOverrideGroups.get(key) || [];

      group.push(item);
      courseOverrideGroups.set(key, group);
      continue;
    }
    if (resolved.policy.bonusMode !== 'on_debt_closed' || !eligibleAgentIds.has(closure.closing.managerUserId)) continue;
    const rule = resolved.policy.bonusRules[closure.category];
    const closedCount = closedCounts.get(`${closure.closing.managerUserId}:${closure.category}`) || 0;
    const appliedPercent = resolveBonusPercent(rule, closedCount);

    items.push({
      sourceKey: `legacy-close:${closure.closing.id}`,
      sourceIncomeId: closure.closing.id,
      sourceSaleId: closure.sale.id,
      agentUserId: closure.closing.managerUserId,
      courseId,
      courseName: closure.sale.course?.name || null,
      category: closure.category,
      calculationMode: 'legacy_debt_closed',
      eventDate: closure.closing.entryDate,
      baseAmount: closure.agreementAmount,
      appliedPercent,
      bonusAmount: Math.round(closure.agreementAmount * appliedPercent / 100),
      agreementAmount: closure.agreementAmount,
      closingIncomeId: closure.closing.id,
      closedCount,
      usedFallback: rule.mode === 'tiered' && !rule.tiers.some((tier) => closedCount >= tier.minSales && (tier.maxSales === null || closedCount <= tier.maxSales)),
    });
  }
  for (const group of courseOverrideGroups.values()) {
    allocateRoundedGroup(group, group[0]?.appliedPercent || 0);
    items.push(...group);
  }

  items.sort((left, right) => left.eventDate.getTime() - right.eventDate.getTime() || left.sourceKey.localeCompare(right.sourceKey));
  const lines = buildLines(items);

  return {
    month,
    policy: resolved.policy,
    policyVersionId: resolved.policyVersionId,
    sourceDigest: digestRows(rows as IncomeRow[], resolved.policy),
    legacySourceDigest: legacyDigestRows(rows as IncomeRow[], resolved.policy),
    totalBonusAmount: lines.reduce((sum, line) => sum + line.bonusAmount, 0),
    lines,
    items,
    finalized: false,
    finalizedAt: null,
  };
}
