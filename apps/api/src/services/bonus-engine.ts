import { createHash } from 'node:crypto';
import { prisma } from '@dashboarduz/db';
import {
  classifyCourseCategoryFromField,
  extractSalarySettings,
  normalizePercentage,
  resolveBonusPercent,
  type SalaryBonusMode,
  type SalaryBonusRules,
  type SalaryCategory,
} from '../trpc/routers/dashboard/helpers';
import { buildTechnicalSaleIdSet } from './technical-income';

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const ELIGIBLE_ROLES = new Set(['Agent', 'OnlineAgent', 'OfflineAgent', 'TeamLeader']);

export type CourseIncomeTier = {
  minAmount: number;
  maxAmount: number | null;
  percent: number;
};

export type CourseBonusOverride = {
  mode: 'monthly_team_income_tiered';
  fallbackPercent: number;
  tiers: CourseIncomeTier[];
};

export type BonusPolicy = {
  schemaVersion: 2;
  bonusMode: SalaryBonusMode;
  bonusRules: SalaryBonusRules;
  courseOverrides: Record<string, CourseBonusOverride>;
};

export type BonusCalculationItem = {
  sourceKey: string;
  sourceIncomeId: string;
  sourceSaleId: string;
  agentUserId: string;
  courseId: string | null;
  courseName: string | null;
  category: SalaryCategory;
  calculationMode: 'legacy_income' | 'legacy_debt_closed' | 'course_team_income';
  eventDate: Date;
  baseAmount: number;
  appliedPercent: number;
  bonusAmount: number;
  agreementAmount: number;
  closingIncomeId: string;
  closedCount: number;
  usedFallback: boolean;
};

export type BonusCalculationLine = {
  groupKey: string;
  agentUserId: string;
  courseId: string | null;
  category: SalaryCategory;
  calculationMode: BonusCalculationItem['calculationMode'];
  qualifyingAmount: number;
  appliedPercent: number;
  bonusAmount: number;
  sourceCount: number;
};

export type BonusMonthCalculation = {
  month: Date;
  policy: BonusPolicy;
  policyVersionId: string | null;
  sourceDigest: string;
  totalBonusAmount: number;
  lines: BonusCalculationLine[];
  items: BonusCalculationItem[];
  finalized: boolean;
  finalizedAt: Date | null;
};

export type BonusIncomeRow = {
  id: string;
  type: string;
  relatedDebtIncomeId: string | null;
  managerUserId: string;
  courseId: string | null;
  coursePriceAmount: number | null;
  debtAmount: number | null;
  paymentAmount: number;
  remainingDebtAmount: number;
  entryDate: Date;
  createdAt: Date;
  course: { id: string; name: string; category: string } | null;
};
type IncomeRow = BonusIncomeRow;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function amount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export function getTashkentMonthStart(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(`${value.slice(0, 7)}-01T00:00:00+05:00`);
  const shifted = new Date(date.getTime() + TASHKENT_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - TASHKENT_OFFSET_MS);
}

export function getTashkentMonthEnd(value: Date | string): Date {
  const start = getTashkentMonthStart(value);
  const shifted = new Date(start.getTime() + TASHKENT_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1) - TASHKENT_OFFSET_MS - 1);
}

export function getTashkentMonthKey(value: Date | string): string {
  const start = getTashkentMonthStart(value);
  const shifted = new Date(start.getTime() + TASHKENT_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function normalizeCourseTier(raw: unknown): CourseIncomeTier | null {
  const row = asObject(raw);
  const minAmount = amount(row.minAmount);
  const maxAmount = row.maxAmount === null || row.maxAmount === undefined || row.maxAmount === ''
    ? null
    : amount(row.maxAmount);
  const percent = normalizePercentage(row.percent);
  if (percent <= 0 || (maxAmount !== null && maxAmount < minAmount)) return null;
  return { minAmount, maxAmount, percent };
}

export function normalizeCourseOverride(raw: unknown): CourseBonusOverride | null {
  const row = asObject(raw);
  if (row.mode !== 'monthly_team_income_tiered') return null;
  const tiers = (Array.isArray(row.tiers) ? row.tiers : [])
    .map(normalizeCourseTier)
    .filter((tier): tier is CourseIncomeTier => Boolean(tier))
    .sort((left, right) => left.minAmount - right.minAmount);
  if (!tiers.length) return null;
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index]!;
    if (tier.maxAmount === null && index !== tiers.length - 1) return null;
    if (index > 0) {
      const previous = tiers[index - 1]!;
      if (previous.maxAmount === null || tier.minAmount <= previous.maxAmount) return null;
    }
  }
  if (tiers[tiers.length - 1]!.maxAmount !== null) return null;
  return {
    mode: 'monthly_team_income_tiered',
    fallbackPercent: normalizePercentage(row.fallbackPercent),
    tiers,
  };
}

export function buildLegacyBonusPolicy(settings: unknown): BonusPolicy {
  const salary = extractSalarySettings(settings);
  return {
    schemaVersion: 2,
    bonusMode: salary.bonusMode,
    bonusRules: salary.bonusRules,
    courseOverrides: {},
  };
}

export function normalizeBonusPolicy(raw: unknown, fallbackSettings?: unknown): BonusPolicy {
  const row = asObject(raw);
  const fallback = buildLegacyBonusPolicy(fallbackSettings);
  const parsedSalary = extractSalarySettings({
    salary: {
      bonusMode: row.bonusMode ?? fallback.bonusMode,
      bonusRules: row.bonusRules ?? fallback.bonusRules,
    },
  });
  const rawOverrides = asObject(row.courseOverrides);
  const courseOverrides: Record<string, CourseBonusOverride> = {};
  for (const [courseId, candidate] of Object.entries(rawOverrides)) {
    const normalized = normalizeCourseOverride(candidate);
    if (courseId.trim() && normalized) courseOverrides[courseId] = normalized;
  }
  return {
    schemaVersion: 2,
    bonusMode: parsedSalary.bonusMode,
    bonusRules: parsedSalary.bonusRules,
    courseOverrides,
  };
}

export function resolveCourseIncomePercent(rule: CourseBonusOverride, teamAmount: number): { percent: number; usedFallback: boolean } {
  const tier = rule.tiers.find((candidate) => (
    teamAmount >= candidate.minAmount
    && (candidate.maxAmount === null || teamAmount <= candidate.maxAmount)
  ));
  return tier
    ? { percent: normalizePercentage(tier.percent), usedFallback: false }
    : { percent: normalizePercentage(rule.fallbackPercent), usedFallback: true };
}

export function resolveFullyPaidClosure(sale: Pick<IncomeRow, 'coursePriceAmount' | 'debtAmount'>, chain: IncomeRow[]): {
  closing: IncomeRow;
  agreementAmount: number;
} | null {
  const chainTotal = chain.reduce((sum, row) => sum + amount(row.paymentAmount), 0);
  const agreementAmount = amount(sale.coursePriceAmount ?? sale.debtAmount) || chainTotal;
  if (agreementAmount <= 0) return null;
  let paid = 0;
  for (const row of chain) {
    paid += amount(row.paymentAmount);
    if (paid >= agreementAmount) return { closing: row, agreementAmount };
  }
  return null;
}

export async function resolveEffectiveBonusPolicy(tenantId: string, month: Date): Promise<{
  policy: BonusPolicy;
  policyVersionId: string | null;
}> {
  const monthStart = getTashkentMonthStart(month);
  const [tenant, version] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }),
    prisma.bonusPolicyVersion.findFirst({
      where: { tenantId, effectiveMonth: { lte: monthStart } },
      orderBy: { effectiveMonth: 'desc' },
    }),
  ]);
  const fallback = buildLegacyBonusPolicy(tenant?.settings);
  return {
    policy: version ? normalizeBonusPolicy(version.policy, tenant?.settings) : fallback,
    policyVersionId: version?.id ?? null,
  };
}

function getCategory(row: IncomeRow): SalaryCategory | null {
  const category = classifyCourseCategoryFromField(row.course?.category || row.course?.name);
  return category === 'other' ? null : category;
}

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

function digestRows(rows: IncomeRow[], policy: BonusPolicy): string {
  const payload = rows.map((row) => [
    row.id, row.type, row.relatedDebtIncomeId, row.managerUserId, row.courseId,
    row.coursePriceAmount, row.paymentAmount, row.entryDate.toISOString(),
  ]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  return createHash('sha256').update(JSON.stringify({ policy, payload })).digest('hex');
}

export async function calculateBonusMonth(params: {
  tenantId: string;
  month: Date;
  policy?: BonusPolicy;
  policyVersionId?: string | null;
}): Promise<BonusMonthCalculation> {
  const month = getTashkentMonthStart(params.month);
  const monthEnd = getTashkentMonthEnd(month);
  const resolved = params.policy
    ? { policy: params.policy, policyVersionId: params.policyVersionId ?? null }
    : await resolveEffectiveBonusPolicy(params.tenantId, month);
  const [users, rows] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId: params.tenantId, isActive: true, roles: { hasSome: [...ELIGIBLE_ROLES] } },
      select: { id: true, roles: true },
    }),
    prisma.income.findMany({
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
    const legacyKey = `${sale.managerUserId}:${category}`;
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
    if (resolved.policy.bonusMode !== 'on_debt_closed' || !eligibleAgentIds.has(closure.sale.managerUserId)) continue;
    const rule = resolved.policy.bonusRules[closure.category];
    const closedCount = closedCounts.get(`${closure.sale.managerUserId}:${closure.category}`) || 0;
    const appliedPercent = resolveBonusPercent(rule, closedCount);
    items.push({
      sourceKey: `legacy-close:${closure.closing.id}`,
      sourceIncomeId: closure.closing.id,
      sourceSaleId: closure.sale.id,
      agentUserId: closure.sale.managerUserId,
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
    totalBonusAmount: lines.reduce((sum, line) => sum + line.bonusAmount, 0),
    lines,
    items,
    finalized: false,
    finalizedAt: null,
  };
}

export async function getBonusMonth(params: { tenantId: string; month: Date; preferSnapshot?: boolean }): Promise<BonusMonthCalculation> {
  const month = getTashkentMonthStart(params.month);
  if (params.preferSnapshot !== false) {
    const snapshot = await prisma.bonusMonthSnapshot.findUnique({
      where: { tenantId_month: { tenantId: params.tenantId, month } },
      include: { lines: true, items: true },
    });
    if (snapshot) {
      return {
        month,
        policy: normalizeBonusPolicy(snapshot.policy),
        policyVersionId: snapshot.policyVersionId,
        sourceDigest: snapshot.sourceDigest,
        totalBonusAmount: snapshot.totalBonusAmount,
        lines: snapshot.lines.map((line) => ({
          groupKey: line.groupKey,
          agentUserId: line.agentUserId,
          courseId: line.courseId,
          category: line.category as SalaryCategory,
          calculationMode: line.calculationMode as BonusCalculationItem['calculationMode'],
          qualifyingAmount: line.qualifyingAmount,
          appliedPercent: line.appliedPercent,
          bonusAmount: line.bonusAmount,
          sourceCount: line.sourceCount,
        })),
        items: snapshot.items.map((item) => {
          const metadata = asObject(item.metadata);
          return {
            sourceKey: item.sourceKey,
            sourceIncomeId: item.sourceIncomeId,
            sourceSaleId: item.sourceSaleId,
            agentUserId: item.agentUserId,
            courseId: item.courseId,
            courseName: typeof metadata.courseName === 'string' ? metadata.courseName : null,
            category: item.category as SalaryCategory,
            calculationMode: item.calculationMode as BonusCalculationItem['calculationMode'],
            eventDate: item.eventDate,
            baseAmount: item.baseAmount,
            appliedPercent: item.appliedPercent,
            bonusAmount: item.bonusAmount,
            agreementAmount: amount(metadata.agreementAmount),
            closingIncomeId: typeof metadata.closingIncomeId === 'string' ? metadata.closingIncomeId : item.sourceIncomeId,
            closedCount: amount(metadata.closedCount),
            usedFallback: metadata.usedFallback === true,
          };
        }),
        finalized: true,
        finalizedAt: snapshot.finalizedAt,
      };
    }
  }
  return calculateBonusMonth({ tenantId: params.tenantId, month });
}

export async function calculateBonusRange(params: {
  tenantId: string;
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<{ items: BonusCalculationItem[]; months: BonusMonthCalculation[]; totalBonusAmount: number }> {
  const months: BonusMonthCalculation[] = [];
  let cursor = getTashkentMonthStart(params.rangeStart);
  const finalMonth = getTashkentMonthStart(params.rangeEnd);
  while (cursor <= finalMonth) {
    months.push(await getBonusMonth({ tenantId: params.tenantId, month: cursor }));
    const shifted = new Date(cursor.getTime() + TASHKENT_OFFSET_MS);
    cursor = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1) - TASHKENT_OFFSET_MS);
  }
  const items = months.flatMap((month) => month.items).filter((item) => (
    item.eventDate >= params.rangeStart && item.eventDate <= params.rangeEnd
  ));
  return {
    items,
    months,
    totalBonusAmount: items.reduce((sum, item) => sum + item.bonusAmount, 0),
  };
}

export async function finalizeBonusMonth(params: { tenantId: string; month: Date; userId: string }): Promise<BonusMonthCalculation> {
  const month = getTashkentMonthStart(params.month);
  if (getTashkentMonthEnd(month) >= new Date()) throw new Error('Only completed months can be finalized.');
  const existing = await prisma.bonusMonthSnapshot.findUnique({ where: { tenantId_month: { tenantId: params.tenantId, month } } });
  if (existing) return getBonusMonth({ tenantId: params.tenantId, month });
  const calculation = await calculateBonusMonth({ tenantId: params.tenantId, month });
  await prisma.$transaction(async (tx) => {
    const snapshot = await tx.bonusMonthSnapshot.create({
      data: {
        tenantId: params.tenantId,
        month,
        policyVersionId: calculation.policyVersionId,
        policy: calculation.policy as any,
        sourceDigest: calculation.sourceDigest,
        totalBonusAmount: calculation.totalBonusAmount,
        finalizedByUserId: params.userId,
      },
    });
    if (calculation.lines.length) {
      await tx.bonusSnapshotLine.createMany({ data: calculation.lines.map((line) => ({ ...line, tenantId: params.tenantId, snapshotId: snapshot.id })) });
    }
    if (calculation.items.length) {
      await tx.bonusSnapshotItem.createMany({
        data: calculation.items.map((item) => ({
          tenantId: params.tenantId,
          snapshotId: snapshot.id,
          sourceKey: item.sourceKey,
          sourceIncomeId: item.sourceIncomeId,
          sourceSaleId: item.sourceSaleId,
          agentUserId: item.agentUserId,
          courseId: item.courseId,
          category: item.category,
          calculationMode: item.calculationMode,
          eventDate: item.eventDate,
          baseAmount: item.baseAmount,
          appliedPercent: item.appliedPercent,
          bonusAmount: item.bonusAmount,
          metadata: {
            courseName: item.courseName,
            agreementAmount: item.agreementAmount,
            closingIncomeId: item.closingIncomeId,
            closedCount: item.closedCount,
            usedFallback: item.usedFallback,
          },
        })),
      });
    }
  });
  return getBonusMonth({ tenantId: params.tenantId, month });
}

export async function reconcileBonusMonth(params: { tenantId: string; month: Date; actorUserId?: string | null }): Promise<number> {
  const month = getTashkentMonthStart(params.month);
  const snapshot = await prisma.bonusMonthSnapshot.findUnique({
    where: { tenantId_month: { tenantId: params.tenantId, month } },
    include: { lines: true, adjustments: true },
  });
  if (!snapshot) return 0;
  const current = await calculateBonusMonth({
    tenantId: params.tenantId,
    month,
    policy: normalizeBonusPolicy(snapshot.policy),
    policyVersionId: snapshot.policyVersionId,
  });
  if (current.sourceDigest === snapshot.sourceDigest) return 0;
  const originalByKey = new Map(snapshot.lines.map((line) => [line.groupKey, line]));
  const currentByKey = new Map(current.lines.map((line) => [line.groupKey, line]));
  const keys = new Set([...originalByKey.keys(), ...currentByKey.keys()]);
  let pendingCount = 0;
  for (const groupKey of keys) {
    const original = originalByKey.get(groupKey);
    const next = currentByKey.get(groupKey);
    const approved = snapshot.adjustments
      .filter((adjustment) => adjustment.groupKey === groupKey && adjustment.status === 'approved')
      .reduce((sum, adjustment) => sum + adjustment.deltaAmount, 0);
    const delta = (next?.bonusAmount || 0) - (original?.bonusAmount || 0) - approved;
    const pending = snapshot.adjustments.find((adjustment) => adjustment.groupKey === groupKey && adjustment.status === 'pending');
    if (delta === 0) {
      if (pending) await prisma.bonusAdjustment.delete({ where: { id: pending.id } });
      continue;
    }
    const rejectedSameDigest = snapshot.adjustments.some((adjustment) => (
      adjustment.groupKey === groupKey && adjustment.status === 'rejected' && adjustment.sourceDigest === current.sourceDigest
    ));
    if (rejectedSameDigest) continue;
    const data = {
      deltaAmount: delta,
      outstandingAmount: delta,
      sourceDigest: current.sourceDigest,
      agentUserId: next?.agentUserId || original!.agentUserId,
      courseId: next?.courseId ?? original?.courseId ?? null,
      category: next?.category || original!.category,
    };
    const adjustment = pending
      ? await prisma.bonusAdjustment.update({ where: { id: pending.id }, data })
      : await prisma.bonusAdjustment.create({ data: { ...data, tenantId: params.tenantId, snapshotId: snapshot.id, groupKey } });
    await prisma.bonusAdjustmentAudit.create({
      data: {
        tenantId: params.tenantId,
        adjustmentId: adjustment.id,
        action: pending ? 'recalculated' : 'created',
        actorUserId: params.actorUserId || null,
        metadata: { previousMonth: getTashkentMonthKey(month), sourceDigest: current.sourceDigest },
      },
    });
    pendingCount += 1;
  }
  return pendingCount;
}

export async function reconcileFinalizedBonusMonths(params: { tenantId: string; actorUserId?: string | null }): Promise<number> {
  const snapshots = await prisma.bonusMonthSnapshot.findMany({
    where: { tenantId: params.tenantId },
    select: { month: true },
    orderBy: { month: 'asc' },
  });
  let total = 0;
  for (const snapshot of snapshots) {
    total += await reconcileBonusMonth({ tenantId: params.tenantId, month: snapshot.month, actorUserId: params.actorUserId });
  }
  return total;
}

export async function reviewBonusAdjustment(params: {
  tenantId: string;
  adjustmentId: string;
  userId: string;
  action: 'approve' | 'reject';
  note?: string;
}) {
  const adjustment = await prisma.bonusAdjustment.findFirst({ where: { id: params.adjustmentId, tenantId: params.tenantId, status: 'pending' } });
  if (!adjustment) throw new Error('Pending bonus adjustment was not found.');
  if (params.action === 'reject' && !params.note?.trim()) throw new Error('A rejection reason is required.');
  const payoutMonth = params.action === 'approve' ? getTashkentMonthStart(new Date()) : null;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.bonusAdjustment.update({
      where: { id: adjustment.id },
      data: {
        status: params.action === 'approve' ? 'approved' : 'rejected',
        payoutMonth,
        reviewedByUserId: params.userId,
        reviewNote: params.note?.trim() || null,
        reviewedAt: new Date(),
      },
    });
    await tx.bonusAdjustmentAudit.create({
      data: {
        tenantId: params.tenantId,
        adjustmentId: adjustment.id,
        action: params.action === 'approve' ? 'approved' : 'rejected',
        actorUserId: params.userId,
        metadata: { note: params.note?.trim() || null, payoutMonth: payoutMonth?.toISOString() || null },
      },
    });
    return updated;
  });
}

export async function getApprovedAdjustmentsForMonth(tenantId: string, month: Date) {
  const monthStart = getTashkentMonthStart(month);
  const monthEnd = getTashkentMonthEnd(month);
  return prisma.bonusAdjustment.findMany({
    where: {
      tenantId,
      status: 'approved',
      outstandingAmount: { not: 0 },
      payoutMonth: { lte: monthEnd },
    },
    orderBy: [{ payoutMonth: 'asc' }, { createdAt: 'asc' }],
  });
}
