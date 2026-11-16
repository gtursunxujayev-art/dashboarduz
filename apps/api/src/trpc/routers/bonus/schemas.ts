import { penaltyTargetSchema } from '@dashboarduz/shared';
import { z } from 'zod';

import { BONUS_BASE_MODES, BONUS_PLAN_CATEGORIES, BONUS_PLAN_PERIODS, BONUS_RULE_MODES, KPI_METRIC_KEYS } from '../../../services/bonus-config/types';

export const createPlanInput = z.object({
  name: z.string().min(1).max(120),
  isActive: z.boolean().optional(),
  periodMode: z.enum(BONUS_PLAN_PERIODS),
  courseCategory: z.enum(BONUS_PLAN_CATEGORIES),
  courseId: z.string().uuid().nullable().optional(),
  tariffId: z.string().uuid().nullable().optional(),
  subTariffId: z.string().uuid().nullable().optional(),
  subTariffName: z.string().trim().min(1).max(120).nullable().optional(),
  targetClosedSales: z.number().int().positive(),
  bonusAmount: z.number().int().positive(),
});

export const updatePlanInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
  periodMode: z.enum(BONUS_PLAN_PERIODS).optional(),
  courseCategory: z.enum(BONUS_PLAN_CATEGORIES).optional(),
  courseId: z.string().uuid().nullable().optional(),
  tariffId: z.string().uuid().nullable().optional(),
  subTariffId: z.string().uuid().nullable().optional(),
  subTariffName: z.string().trim().min(1).max(120).nullable().optional(),
  targetClosedSales: z.number().int().positive().optional(),
  bonusAmount: z.number().int().positive().optional(),
});

const bonusTierInput = z.object({
  minSales: z.number().int().positive(),
  maxSales: z.number().int().positive().nullable(),
  percent: z.number().positive().max(100),
});

const categoryBonusRuleInput = z.object({
  mode: z.enum(BONUS_RULE_MODES),
  simplePercent: z.number().min(0).max(100),
  tiers: z.array(bonusTierInput).default([]),
});

export const updateBonusRulesInput = z.object({
  bonusMode: z.enum(BONUS_BASE_MODES),
  bonusRules: z.object({
    online: categoryBonusRuleInput,
    offline: categoryBonusRuleInput,
    intensive: categoryBonusRuleInput,
    additional_service: categoryBonusRuleInput,
  }),
});

const courseIncomeTierInput = z.object({
  minAmount: z.number().int().min(0),
  maxAmount: z.number().int().min(0).nullable(),
  percent: z.number().min(0).max(100),
});

const courseOverrideInput = z.object({
  mode: z.literal('monthly_team_income_tiered'),
  fallbackPercent: z.number().min(0).max(100),
  tiers: z.array(courseIncomeTierInput).min(1),
});

export const saveBonusPolicyInput = updateBonusRulesInput.extend({
  effectiveMonth: z.string().regex(/^\d{4}-\d{2}$/),
  courseOverrides: z.record(z.string().uuid(), courseOverrideInput),
});

export const bonusMonthInput = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

export const updateFixedSalariesInput = z.object({
  fixedSalaries: z.array(
    z.object({
      userId: z.string().uuid(),
      amount: z.number().int().nonnegative(),
    }),
  ),
});

export const updateAttendancePenaltySettingsInput = z.object({
  lateMinutePenaltyUZS: z.number().int().nonnegative(),
  missingHourPenaltyUZS: z.number().int().nonnegative(),
  absenceDayPenaltyUZS: z.number().int().nonnegative(),
  applyToFixedSalary: z.boolean(),
  applyToKpi: z.boolean(),
  latePenaltyTarget: penaltyTargetSchema,
  missingHourPenaltyTarget: penaltyTargetSchema,
  absenceDayPenaltyTarget: penaltyTargetSchema,
  monthlyPenaltyCapUZS: z.number().int().nonnegative(),
});

const kpiThresholdInput = z.object({
  full: z.number().nonnegative(),
  half: z.number().nonnegative(),
});

export const updateKpiSettingsInput = z.object({
  monthlyKpiAmount: z.number().int().nonnegative(),
  selectedMetrics: z.array(z.enum(KPI_METRIC_KEYS)).max(4),
  thresholds: z.record(z.enum(KPI_METRIC_KEYS), kpiThresholdInput),
});
