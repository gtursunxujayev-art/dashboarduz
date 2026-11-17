import { type DbClient } from '@dashboarduz/db';
import { TASHKENT_OFFSET_MS } from '@dashboarduz/shared';

import { normalizePercentage } from '../../lib/number';
import { asObjectOrEmpty } from '../../lib/object';
import { classifyCourseCategoryFromField, extractSalarySettings, type SalaryCategory } from '../../trpc/routers/dashboard/helpers';

import type { BonusPolicy, CourseBonusOverride, CourseIncomeTier, IncomeRow } from './types';

export function amount(value: unknown): number {
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
  const row = asObjectOrEmpty(raw);
  const minAmount = amount(row.minAmount);
  const maxAmount = row.maxAmount === null || row.maxAmount === undefined || row.maxAmount === ''
    ? null
    : amount(row.maxAmount);
  const percent = normalizePercentage(row.percent);

  if (percent <= 0 || (maxAmount !== null && maxAmount < minAmount)) return null;

  return { minAmount, maxAmount, percent };
}

export function normalizeCourseOverride(raw: unknown): CourseBonusOverride | null {
  const row = asObjectOrEmpty(raw);

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
  const row = asObjectOrEmpty(raw);
  const fallback = buildLegacyBonusPolicy(fallbackSettings);
  const parsedSalary = extractSalarySettings({
    salary: {
      bonusMode: row.bonusMode ?? fallback.bonusMode,
      bonusRules: row.bonusRules ?? fallback.bonusRules,
    },
  });
  const rawOverrides = asObjectOrEmpty(row.courseOverrides);
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

export async function resolveEffectiveBonusPolicy(tenantId: string, month: Date, db: DbClient): Promise<{
  policy: BonusPolicy;
  policyVersionId: string | null;
}> {
  const monthStart = getTashkentMonthStart(month);
  const [tenant, version] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }),
    db.bonusPolicyVersion.findFirst({
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

export function getCategory(row: IncomeRow): SalaryCategory | null {
  const category = classifyCourseCategoryFromField(row.course?.category || row.course?.name);

  return category === 'other' ? null : category;
}
