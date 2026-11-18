import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { normalizePercentage } from '../../../lib/number';
import { asObjectOrEmpty } from '../../../lib/object';
import { parseAttendancePenaltySettings, parseBonusRules, parseFixedSalaries, parseKpiSettings, sanitizeCategoryRule, validateTierRules } from '../../../services/bonus-config/rules';
import { BONUS_RULE_CATEGORIES, type BonusRuleCategory, canReadBonusPlans, getCategoryLabel, type SalaryBonusRules } from '../../../services/bonus-config/types';
import { buildLegacyBonusPolicy, getTashkentMonthKey, getTashkentMonthStart, normalizeBonusPolicy, resolveEffectiveBonusPolicy } from '../../../services/bonus-engine';
import { adminProcedure, protectedProcedure } from '../../trpc';

import { saveBonusPolicyInput, updateBonusRulesInput } from './schemas';

export const bonusPolicyProcedures = {
  getSalaryConfig: protectedProcedure.query(async ({ ctx }) => {
    if (!canReadBonusPlans(ctx.user.roles)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Bonus settings are available for Admin/Manager/TeamLeader only.' });
    }

    const tenant = await ctx.db.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { settings: true },
    });

    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    const parsed = parseBonusRules(tenant.settings);

    return {
      bonusMode: parsed.bonusMode,
      bonusRules: parsed.bonusRules,
      fixedSalaries: parseFixedSalaries(tenant.settings),
      attendancePenaltySettings: parseAttendancePenaltySettings(tenant.settings),
      kpiSettings: parseKpiSettings(tenant.settings),
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
        throw new TRPCError({ code: 'BAD_REQUEST', message: `${getCategoryLabel(category)}: ${validationError}` });
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
    const tenant = await ctx.db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } });

    if (!tenant) throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    const normalizedRules: SalaryBonusRules = {
      online: sanitizeCategoryRule(input.bonusRules.online, input.bonusRules.online.simplePercent),
      offline: sanitizeCategoryRule(input.bonusRules.offline, input.bonusRules.offline.simplePercent),
      intensive: sanitizeCategoryRule(input.bonusRules.intensive, input.bonusRules.intensive.simplePercent),
      additional_service: sanitizeCategoryRule(input.bonusRules.additional_service, input.bonusRules.additional_service.simplePercent),
    };
    const policy = normalizeBonusPolicy({
      schemaVersion: 2,
      bonusMode: input.bonusMode,
      bonusRules: normalizedRules,
      courseOverrides: input.courseOverrides,
    }, tenant.settings);
    const settingsObject = asObjectOrEmpty(tenant.settings);
    const salarySettings = asObjectOrEmpty(settingsObject.salary);

    await ctx.db.$transaction(async (tx) => {
      const count = await tx.bonusPolicyVersion.count({ where: { tenantId: ctx.tenantId } });

      if (count === 0) {
        await tx.bonusPolicyVersion.create({
          data: {
            tenantId: ctx.tenantId,
            effectiveMonth: new Date('1970-01-01T00:00:00.000Z'),
            policy: buildLegacyBonusPolicy(tenant.settings) as any,
            createdByUserId: ctx.user.userId,
          },
        });
      }
      await tx.bonusPolicyVersion.upsert({
        where: { tenantId_effectiveMonth: { tenantId: ctx.tenantId, effectiveMonth } },
        create: {
          tenantId: ctx.tenantId,
          effectiveMonth,
          policy: policy as any,
          createdByUserId: ctx.user.userId,
        },
        update: { policy: policy as any, createdByUserId: ctx.user.userId },
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
          } as any,
        },
      });
    }, {
      // Same limits as income creation: the default 5 s is not enough for these writes against a slow database.
      maxWait: 10_000,
      timeout: 30_000,
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
            message: `${getCategoryLabel(category)}: ${validationError}`,
          });
        }
      }
    }

    const tenant = await ctx.db.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { settings: true },
    });

    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    const settingsObject = asObjectOrEmpty(tenant.settings);
    const salarySettings = asObjectOrEmpty(settingsObject.salary);
    const normalizedRules: SalaryBonusRules = {
      online: sanitizeCategoryRule(input.bonusRules.online, input.bonusRules.online.simplePercent),
      offline: sanitizeCategoryRule(input.bonusRules.offline, input.bonusRules.offline.simplePercent),
      intensive: sanitizeCategoryRule(input.bonusRules.intensive, input.bonusRules.intensive.simplePercent),
      additional_service: sanitizeCategoryRule(
        input.bonusRules.additional_service,
        input.bonusRules.additional_service.simplePercent,
      ),
    };
    const compatibilityPercentages = {
      online: normalizedRules.online.mode === 'simple' ? normalizedRules.online.simplePercent : 0,
      offline: normalizedRules.offline.mode === 'simple' ? normalizedRules.offline.simplePercent : 0,
      intensive: normalizedRules.intensive.mode === 'simple' ? normalizedRules.intensive.simplePercent : 0,
      additional_service:
        normalizedRules.additional_service.mode === 'simple'
          ? normalizedRules.additional_service.simplePercent
          : 0,
    };

    const nextSettings = {
      ...settingsObject,
      salary: {
        ...salarySettings,
        bonusMode: input.bonusMode,
        bonusRules: normalizedRules,
        bonusPercentages: compatibilityPercentages,
      },
    };

    await ctx.db.tenant.update({
      where: { id: ctx.tenantId },
      data: {
        settings: JSON.parse(JSON.stringify(nextSettings)),
      },
    });

    await ctx.db.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        action: 'bonus_rules_update',
        resource: 'tenant_settings',
        resourceId: ctx.tenantId,
      },
    });

    return { success: true };
  }),
};
