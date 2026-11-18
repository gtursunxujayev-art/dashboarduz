import { courseCategoryLabel } from '@dashboarduz/shared';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { normalizePercentage } from '../../../lib/number';
import { asObjectOrEmpty } from '../../../lib/object';
import { loadTenantSettings, saveTenantSettings, withSalarySettings } from '../../../lib/tenant-settings';
import { parseAttendancePenaltySettings, parseBonusRules, parseFixedSalaries, parseKpiSettings, sanitizeCategoryRule, validateTierRules } from '../../../services/bonus-config/rules';
import { BONUS_RULE_CATEGORIES, type BonusRuleCategory, canReadBonusPlans, type SalaryBonusRules } from '../../../services/bonus-config/types';
import { buildLegacyBonusPolicy, getTashkentMonthKey, getTashkentMonthStart, normalizeBonusPolicy, resolveEffectiveBonusPolicy } from '../../../services/bonus-engine';
import { adminProcedure, protectedProcedure } from '../../trpc';

import { saveBonusPolicyInput, updateBonusRulesInput } from './schemas';

/** Every category's rule run through sanitizeCategoryRule (with its own simple percent as the fallback). */
function sanitizeBonusRules(rules: SalaryBonusRules): SalaryBonusRules {
  return {
    online: sanitizeCategoryRule(rules.online, rules.online.simplePercent),
    offline: sanitizeCategoryRule(rules.offline, rules.offline.simplePercent),
    intensive: sanitizeCategoryRule(rules.intensive, rules.intensive.simplePercent),
    additional_service: sanitizeCategoryRule(rules.additional_service, rules.additional_service.simplePercent),
  };
}

export const bonusPolicyProcedures = {
  getSalaryConfig: protectedProcedure.query(async ({ ctx }) => {
    if (!canReadBonusPlans(ctx.user.roles)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Bonus settings are available for Admin/Manager/TeamLeader only.' });
    }

    const tenantSettings = await loadTenantSettings(ctx.db, ctx.tenantId);

    const parsed = parseBonusRules(tenantSettings);

    return {
      bonusMode: parsed.bonusMode,
      bonusRules: parsed.bonusRules,
      fixedSalaries: parseFixedSalaries(tenantSettings),
      attendancePenaltySettings: parseAttendancePenaltySettings(tenantSettings),
      kpiSettings: parseKpiSettings(tenantSettings),
    };
  }),
  getPolicyEditor: protectedProcedure
    .input(z.object({ effectiveMonth: z.string().regex(/^\d{4}-\d{2}$/).optional() }).optional())
    .query(async ({ ctx, input }) => {
    if (!canReadBonusPlans(ctx.user.roles)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Bonus settings are available for Admin/Manager/TeamLeader only.' });
    }
    const now = new Date();
    const requestedMonth = input?.effectiveMonth ? getTashkentMonthStart(input.effectiveMonth) : now;
    const [resolved, versions, courses] = await Promise.all([
      resolveEffectiveBonusPolicy(ctx.tenantId, requestedMonth, ctx.db),
      ctx.db.bonusPolicyVersion.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { effectiveMonth: 'desc' },
        select: { id: true, effectiveMonth: true, createdAt: true, updatedAt: true },
      }),
      ctx.db.course.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        select: { id: true, name: true, category: true, isActive: true },
      }),
    ]);

    return {
      currentMonth: getTashkentMonthKey(now),
      selectedMonth: getTashkentMonthKey(requestedMonth),
      policyVersionId: resolved.policyVersionId,
      policy: resolved.policy,
      versions: versions.map((version) => ({
        ...version,
        effectiveMonth: getTashkentMonthKey(version.effectiveMonth),
      })),
      courses,
    };
  }),
  savePolicyVersion: adminProcedure.input(saveBonusPolicyInput).mutation(async ({ ctx, input }) => {
    const effectiveMonth = getTashkentMonthStart(input.effectiveMonth);
    const currentMonth = getTashkentMonthStart(new Date());

    if (effectiveMonth < currentMonth) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: "O'tgan oy bonus siyosatini o'zgartirib bo'lmaydi." });
    }
    for (const category of BONUS_RULE_CATEGORIES) {
      const rule = input.bonusRules[category];

      if (rule.mode !== 'tiered') continue;
      const tiers = rule.tiers.map((tier) => ({
        minSales: Math.max(1, Math.floor(tier.minSales)),
        maxSales: tier.maxSales === null ? null : Math.max(1, Math.floor(tier.maxSales)),
        percent: normalizePercentage(tier.percent),
      })).sort((left, right) => left.minSales - right.minSales);
      const validationError = validateTierRules(tiers);

      if (validationError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `${courseCategoryLabel(category)}: ${validationError}` });
      }
    }
    for (const [courseId, override] of Object.entries(input.courseOverrides)) {
      const sorted = [...override.tiers].sort((left, right) => left.minAmount - right.minAmount);

      for (let index = 0; index < sorted.length; index += 1) {
        const tier = sorted[index]!;

        if (tier.maxAmount !== null && tier.maxAmount < tier.minAmount) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `${courseId}: bonus diapazoni noto'g'ri.` });
        }
        if (tier.maxAmount === null && index !== sorted.length - 1) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `${courseId}: ochiq diapazon faqat oxirgi tier bo'lishi mumkin.` });
        }
        if (index > 0) {
          const previous = sorted[index - 1]!;

          if (previous.maxAmount === null || tier.minAmount <= previous.maxAmount) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `${courseId}: tierlar kesishmasligi kerak.` });
          }
        }
      }
      if (sorted[sorted.length - 1]?.maxAmount !== null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `${courseId}: oxirgi tier ochiq bo'lishi kerak.` });
      }
    }
    const tenantSettings = await loadTenantSettings(ctx.db, ctx.tenantId);
    const normalizedRules = sanitizeBonusRules(input.bonusRules);
    const policy = normalizeBonusPolicy({
      schemaVersion: 2,
      bonusMode: input.bonusMode,
      bonusRules: normalizedRules,
      courseOverrides: input.courseOverrides,
    }, tenantSettings);
    const settingsObject = asObjectOrEmpty(tenantSettings);
    const salarySettings = asObjectOrEmpty(settingsObject.salary);

    await ctx.db.$transaction(async (tx) => {
      const count = await tx.bonusPolicyVersion.count({ where: { tenantId: ctx.tenantId } });

      if (count === 0) {
        await tx.bonusPolicyVersion.create({
          data: {
            tenantId: ctx.tenantId,
            effectiveMonth: new Date('1970-01-01T00:00:00.000Z'),
            policy: buildLegacyBonusPolicy(tenantSettings) as Prisma.InputJsonValue,
            createdByUserId: ctx.user.userId,
          },
        });
      }
      await tx.bonusPolicyVersion.upsert({
        where: { tenantId_effectiveMonth: { tenantId: ctx.tenantId, effectiveMonth } },
        create: {
          tenantId: ctx.tenantId,
          effectiveMonth,
          policy: policy as Prisma.InputJsonValue,
          createdByUserId: ctx.user.userId,
        },
        update: { policy: policy as Prisma.InputJsonValue, createdByUserId: ctx.user.userId },
      });
      await tx.tenant.update({
        where: { id: ctx.tenantId },
        data: {
          settings: {
            ...settingsObject,
            salary: {
              ...salarySettings,
              bonusMode: policy.bonusMode,
              bonusRules: policy.bonusRules,
              courseBonusOverrides: policy.courseOverrides,
            },
          } as Prisma.InputJsonObject,
        },
      });
    });

    return { success: true, effectiveMonth: input.effectiveMonth, policy };
  }),
  updateBonusRules: adminProcedure.input(updateBonusRulesInput).mutation(async ({ ctx, input }) => {
    const categories = BONUS_RULE_CATEGORIES as readonly BonusRuleCategory[];

    for (const category of categories) {
      const rule = input.bonusRules[category];

      if (!rule) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `${category} bonus qoidasi topilmadi.` });
      }
      if (rule.mode === 'tiered') {
        const tiers = [...rule.tiers]
          .map((tier) => ({
            minSales: Math.max(1, Math.floor(tier.minSales)),
            maxSales: tier.maxSales === null ? null : Math.max(1, Math.floor(tier.maxSales)),
            percent: normalizePercentage(tier.percent),
          }))
          .sort((a, b) => a.minSales - b.minSales);
        const validationError = validateTierRules(tiers);

        if (validationError) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `${courseCategoryLabel(category)}: ${validationError}`,
          });
        }
      }
    }

    const tenantSettings = await loadTenantSettings(ctx.db, ctx.tenantId);

    const normalizedRules = sanitizeBonusRules(input.bonusRules);
    const compatibilityPercentages = {
      online: normalizedRules.online.mode === 'simple' ? normalizedRules.online.simplePercent : 0,
      offline: normalizedRules.offline.mode === 'simple' ? normalizedRules.offline.simplePercent : 0,
      intensive: normalizedRules.intensive.mode === 'simple' ? normalizedRules.intensive.simplePercent : 0,
      additional_service:
        normalizedRules.additional_service.mode === 'simple'
          ? normalizedRules.additional_service.simplePercent
          : 0,
    };

    const nextSettings = withSalarySettings(tenantSettings, {
      bonusMode: input.bonusMode,
      bonusRules: normalizedRules,
      bonusPercentages: compatibilityPercentages,
    });

    await saveTenantSettings({
      db: ctx.db,
      tenantId: ctx.tenantId,
      actorUserId: ctx.user.userId,
      settings: nextSettings,
      auditAction: 'bonus_rules_update',
    });

    return { success: true };
  }),
};
