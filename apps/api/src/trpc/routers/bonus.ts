import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, protectedProcedure, router } from '../trpc';

const BONUS_PLAN_CATEGORIES = ['online', 'offline', 'intensive', 'additional_service'] as const;
const BONUS_PLAN_PERIODS = ['monthly', 'all_time'] as const;
const BONUS_RULE_CATEGORIES = ['online', 'offline', 'intensive', 'additional_service'] as const;
const BONUS_RULE_MODES = ['simple', 'tiered'] as const;
const BONUS_BASE_MODES = ['on_income', 'on_debt_closed'] as const;
const BONUS_READ_ROLES = new Set(['Admin', 'Manager', 'TeamLeader']);

type BonusPlanCategory = (typeof BONUS_PLAN_CATEGORIES)[number];
type BonusPlanPeriodMode = (typeof BONUS_PLAN_PERIODS)[number];
type BonusRuleCategory = (typeof BONUS_RULE_CATEGORIES)[number];
type BonusRuleMode = (typeof BONUS_RULE_MODES)[number];
type BonusBaseMode = (typeof BONUS_BASE_MODES)[number];

type BonusRuleTier = {
  minSales: number;
  maxSales: number | null;
  percent: number;
};

type SalaryCategoryBonusRule = {
  mode: BonusRuleMode;
  simplePercent: number;
  tiers: BonusRuleTier[];
};

type SalaryBonusRules = Record<BonusRuleCategory, SalaryCategoryBonusRule>;

type BonusPlan = {
  id: string;
  name: string;
  isActive: boolean;
  periodMode: BonusPlanPeriodMode;
  courseCategory: BonusPlanCategory;
  courseId: string | null;
  tariffId: string | null;
  subTariffId: string | null;
  subTariffName: string | null;
  targetClosedSales: number;
  bonusAmount: number;
  createdAt: string;
  updatedAt: string;
};

type FixedSalaryRow = {
  userId: string;
  amount: number;
};

type AttendancePenaltySettings = {
  lateMinutePenaltyUZS: number;
  missingHourPenaltyUZS: number;
  absenceDayPenaltyUZS: number;
  applyToFixedSalary: boolean;
  applyToKpi: boolean;
  latePenaltyTarget: 'fixed' | 'kpi';
  missingHourPenaltyTarget: 'fixed' | 'kpi';
  absenceDayPenaltyTarget: 'fixed' | 'kpi';
  monthlyPenaltyCapUZS: number;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function canReadBonusPlans(roles: string[]): boolean {
  return roles.some((role) => BONUS_READ_ROLES.has(role));
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function getCategoryLabel(category: BonusRuleCategory): string {
  if (category === 'online') return 'Online';
  if (category === 'offline') return 'Offline';
  if (category === 'intensive') return 'Intensiv';
  return "Qo'shimcha xizmat";
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizePercentage(value: unknown): number {
  const parsed = toFiniteNumber(value, 0);
  if (parsed <= 0) {
    return 0;
  }
  if (parsed >= 100) {
    return 100;
  }
  return Number(parsed.toFixed(2));
}

function normalizeTier(raw: unknown): BonusRuleTier | null {
  const row = asObject(raw);
  const minSales = Math.floor(toFiniteNumber(row.minSales, 0));
  const maxValue = row.maxSales;
  const maxSales =
    maxValue === null || maxValue === undefined || maxValue === ''
      ? null
      : Math.floor(toFiniteNumber(maxValue, 0));
  const percent = normalizePercentage(row.percent);
  if (minSales <= 0 || percent <= 0) {
    return null;
  }
  if (maxSales !== null && maxSales < minSales) {
    return null;
  }
  return { minSales, maxSales, percent };
}

function validateTierRules(tiers: BonusRuleTier[]): string | null {
  if (!tiers.length) {
    return "Tiered rejimda kamida bitta diapazon bo'lishi shart.";
  }

  for (let index = 0; index < tiers.length; index += 1) {
    const current = tiers[index];
    if (!current) {
      return "Bonus diapazoni noto'g'ri.";
    }
    if (current.minSales <= 0) {
      return "Diapazon boshlanishi 0 dan katta bo'lishi kerak.";
    }
    if (current.percent <= 0) {
      return "Diapazon bonus foizi 0 dan katta bo'lishi kerak.";
    }
    if (current.maxSales !== null && current.maxSales < current.minSales) {
      return "Diapazon tugashi boshlanishidan kichik bo'lishi mumkin emas.";
    }
    if (current.maxSales === null && index !== tiers.length - 1) {
      return "Ochiq diapazon (max bo'sh) faqat oxirgi qatorda bo'lishi mumkin.";
    }
    if (index > 0) {
      const prev = tiers[index - 1];
      if (!prev) {
        return "Bonus diapazonlari tartibi noto'g'ri.";
      }
      const prevMax = prev.maxSales ?? Number.MAX_SAFE_INTEGER;
      if (current.minSales <= prevMax) {
        return "Bonus diapazonlari bir-birini kesib o'tmasligi kerak.";
      }
      if (prev.maxSales === null) {
        return "Ochiq diapazondan keyin yangi diapazon bo'lishi mumkin emas.";
      }
    }
  }

  return null;
}

function createSimpleRule(percent: unknown): SalaryCategoryBonusRule {
  return {
    mode: 'simple',
    simplePercent: normalizePercentage(percent),
    tiers: [],
  };
}

function sanitizeCategoryRule(rawRule: unknown, fallbackPercent: unknown): SalaryCategoryBonusRule {
  const row = asObject(rawRule);
  const mode = BONUS_RULE_MODES.includes(row.mode as BonusRuleMode)
    ? (row.mode as BonusRuleMode)
    : 'simple';
  const simplePercent = normalizePercentage(row.simplePercent ?? fallbackPercent);
  const rawTiers = Array.isArray(row.tiers) ? row.tiers : [];
  const tiers = rawTiers
    .map((tier) => normalizeTier(tier))
    .filter((tier): tier is BonusRuleTier => Boolean(tier))
    .sort((a, b) => a.minSales - b.minSales);

  if (mode === 'tiered') {
    const validationError = validateTierRules(tiers);
    if (!validationError) {
      return {
        mode: 'tiered',
        simplePercent,
        tiers,
      };
    }
  }

  return createSimpleRule(simplePercent);
}

function parseFixedSalaries(settings: unknown): FixedSalaryRow[] {
  const settingsObject = asObject(settings);
  const salarySettings = asObject(settingsObject.salary);
  const fixedRows = Array.isArray(salarySettings.fixedSalaries) ? salarySettings.fixedSalaries : [];

  return fixedRows
    .map((raw) => {
      const row = asObject(raw);
      const userId = typeof row.userId === 'string' ? row.userId.trim() : '';
      const amount = Math.max(0, Math.round(toFiniteNumber(row.amount, 0)));
      if (!userId || amount <= 0) {
        return null;
      }
      return { userId, amount };
    })
    .filter((row): row is FixedSalaryRow => Boolean(row));
}

function parseBonusRules(settings: unknown): {
  bonusMode: BonusBaseMode;
  bonusRules: SalaryBonusRules;
} {
  const settingsObject = asObject(settings);
  const salarySettings = asObject(settingsObject.salary);
  const rawPercentages = asObject(salarySettings.bonusPercentages);
  const rawRules = asObject(salarySettings.bonusRules);
  const bonusMode: BonusBaseMode = salarySettings.bonusMode === 'on_debt_closed' ? 'on_debt_closed' : 'on_income';

  return {
    bonusMode,
    bonusRules: {
      online: sanitizeCategoryRule(rawRules.online, rawPercentages.online),
      offline: sanitizeCategoryRule(rawRules.offline, rawPercentages.offline),
      intensive: sanitizeCategoryRule(rawRules.intensive, rawPercentages.intensive),
      additional_service: sanitizeCategoryRule(rawRules.additional_service, rawPercentages.additional_service),
    },
  };
}

function parseAttendancePenaltySettings(settings: unknown): AttendancePenaltySettings {
  const settingsObject = asObject(settings);
  const salarySettings = asObject(settingsObject.salary);
  const raw = asObject(salarySettings.attendancePenaltySettings);
  const parseTarget = (value: unknown, fallback: 'fixed' | 'kpi'): 'fixed' | 'kpi' => {
    return value === 'fixed' || value === 'kpi' ? value : fallback;
  };
  const fallbackTarget: 'fixed' | 'kpi' = raw.applyToFixedSalary === true ? 'fixed' : 'kpi';

  return {
    lateMinutePenaltyUZS: Math.max(0, Math.round(toFiniteNumber(raw.lateMinutePenaltyUZS, 0))),
    missingHourPenaltyUZS: Math.max(0, Math.round(toFiniteNumber(raw.missingHourPenaltyUZS, 0))),
    absenceDayPenaltyUZS: Math.max(0, Math.round(toFiniteNumber(raw.absenceDayPenaltyUZS, 0))),
    applyToFixedSalary: raw.applyToFixedSalary === true,
    applyToKpi: raw.applyToKpi === true,
    latePenaltyTarget: parseTarget(raw.latePenaltyTarget, fallbackTarget),
    missingHourPenaltyTarget: parseTarget(raw.missingHourPenaltyTarget, fallbackTarget),
    absenceDayPenaltyTarget: parseTarget(raw.absenceDayPenaltyTarget, 'fixed'),
    monthlyPenaltyCapUZS: Math.max(0, Math.round(toFiniteNumber(raw.monthlyPenaltyCapUZS, 0))),
  };
}

function sanitizePlan(raw: unknown): BonusPlan | null {
  const row = asObject(raw);
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  const periodMode = typeof row.periodMode === 'string' ? row.periodMode.trim() : '';
  const courseCategory = typeof row.courseCategory === 'string' ? row.courseCategory.trim() : '';
  const courseId = typeof row.courseId === 'string' && row.courseId.trim() ? row.courseId.trim() : null;
  const tariffId = typeof row.tariffId === 'string' && row.tariffId.trim() ? row.tariffId.trim() : null;
  const subTariffId = typeof row.subTariffId === 'string' && row.subTariffId.trim() ? row.subTariffId.trim() : null;
  const subTariffName = typeof row.subTariffName === 'string' && row.subTariffName.trim()
    ? row.subTariffName.trim()
    : null;
  const targetClosedSales = Number(row.targetClosedSales);
  const bonusAmount = Number(row.bonusAmount);
  const createdAt = typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString();
  const updatedAt = typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString();
  const isActive = row.isActive !== false;

  if (!id || !name) {
    return null;
  }
  if (!BONUS_PLAN_PERIODS.includes(periodMode as BonusPlanPeriodMode)) {
    return null;
  }
  if (!BONUS_PLAN_CATEGORIES.includes(courseCategory as BonusPlanCategory)) {
    return null;
  }
  if (!Number.isFinite(targetClosedSales) || targetClosedSales <= 0) {
    return null;
  }
  if (!Number.isFinite(bonusAmount) || bonusAmount <= 0) {
    return null;
  }

  return {
    id,
    name,
    isActive,
    periodMode: periodMode as BonusPlanPeriodMode,
    courseCategory: courseCategory as BonusPlanCategory,
    courseId,
    tariffId,
    subTariffId,
    subTariffName,
    targetClosedSales: Math.floor(targetClosedSales),
    bonusAmount: Math.round(bonusAmount),
    createdAt,
    updatedAt,
  };
}

function parsePlanBonuses(settings: unknown): BonusPlan[] {
  const settingsObject = asObject(settings);
  const salarySettings = asObject(settingsObject.salary);
  const rawPlans = Array.isArray(salarySettings.planBonuses) ? salarySettings.planBonuses : [];

  const plans: BonusPlan[] = [];
  for (const rawPlan of rawPlans) {
    const plan = sanitizePlan(rawPlan);
    if (plan) {
      plans.push(plan);
    }
  }
  return plans;
}

function mergeSalarySettings(params: {
  currentSettings: unknown;
  nextPlans: BonusPlan[];
}): Record<string, unknown> {
  const settingsObject = asObject(params.currentSettings);
  const salarySettings = asObject(settingsObject.salary);
  return {
    ...settingsObject,
    salary: {
      ...salarySettings,
      planBonuses: params.nextPlans,
    },
  };
}

async function validatePlanScope(params: {
  tenantId: string;
  courseCategory: BonusPlanCategory;
  courseId: string | null;
  tariffId: string | null;
  subTariffId: string | null;
  subTariffName: string | null;
}) {
  const normalizedSubTariffName = params.subTariffName ? normalizeName(params.subTariffName) : '';

  if (!params.courseId && (params.tariffId || params.subTariffId || normalizedSubTariffName)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: "Kurs/Subtarif tanlash uchun avval kurs tanlang.",
    });
  }
  if (!params.tariffId && params.subTariffId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: "Tarif bo'sh bo'lsa subtarif nom bo'yicha tanlanadi.",
    });
  }
  if (params.tariffId && normalizedSubTariffName && !params.subTariffId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: "Tarif tanlanganda subtarif ID bo'yicha tanlanishi kerak.",
    });
  }

  if (params.courseId) {
    const course = await prisma.course.findFirst({
      where: {
        id: params.courseId,
        tenantId: params.tenantId,
      },
      select: {
        id: true,
        category: true,
      },
    });
    if (!course) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: "Tanlangan kurs topilmadi." });
    }
    const normalizedCategory = String(course.category || '').trim().toLowerCase();
    if (normalizedCategory && normalizedCategory !== params.courseCategory) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: "Tanlangan kurs turi va kurs kategoriyasi mos emas.",
      });
    }
  }

  if (params.tariffId) {
    const tariff = await prisma.tariff.findFirst({
      where: {
        id: params.tariffId,
        tenantId: params.tenantId,
        ...(params.courseId ? { courseId: params.courseId } : {}),
      },
      select: {
        id: true,
      },
    });
    if (!tariff) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: "Tanlangan tarif topilmadi." });
    }
  }

  if (params.subTariffId) {
    const subTariff = await prisma.subTariff.findFirst({
      where: {
        id: params.subTariffId,
        tenantId: params.tenantId,
        ...(params.tariffId ? { tariffId: params.tariffId } : {}),
      },
      select: {
        id: true,
      },
    });
    if (!subTariff) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: "Tanlangan subtarif topilmadi." });
    }
  }

  if (!params.tariffId && normalizedSubTariffName && params.courseId) {
    const courseSubTariffs = await prisma.subTariff.findMany({
      where: {
        tenantId: params.tenantId,
        isActive: true,
        tariff: {
          courseId: params.courseId,
          isActive: true,
        },
      },
      select: {
        name: true,
      },
    });

    const hasMatch = courseSubTariffs.some((item) => normalizeName(item.name) === normalizedSubTariffName);
    if (!hasMatch) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: "Tanlangan kurs uchun subtarif topilmadi.",
      });
    }
  }
}

const createPlanInput = z.object({
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

const updatePlanInput = z.object({
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

const updateBonusRulesInput = z.object({
  bonusMode: z.enum(BONUS_BASE_MODES),
  bonusRules: z.object({
    online: categoryBonusRuleInput,
    offline: categoryBonusRuleInput,
    intensive: categoryBonusRuleInput,
    additional_service: categoryBonusRuleInput,
  }),
});

const updateFixedSalariesInput = z.object({
  fixedSalaries: z.array(
    z.object({
      userId: z.string().uuid(),
      amount: z.number().int().nonnegative(),
    }),
  ),
});

const updateAttendancePenaltySettingsInput = z.object({
  lateMinutePenaltyUZS: z.number().int().nonnegative(),
  missingHourPenaltyUZS: z.number().int().nonnegative(),
  absenceDayPenaltyUZS: z.number().int().nonnegative(),
  applyToFixedSalary: z.boolean(),
  applyToKpi: z.boolean(),
  latePenaltyTarget: z.enum(['fixed', 'kpi']),
  missingHourPenaltyTarget: z.enum(['fixed', 'kpi']),
  absenceDayPenaltyTarget: z.enum(['fixed', 'kpi']),
  monthlyPenaltyCapUZS: z.number().int().nonnegative(),
});

export const bonusRouter = router({
  getSalaryConfig: protectedProcedure.query(async ({ ctx }) => {
    if (!canReadBonusPlans(ctx.user.roles)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Bonus settings are available for Admin/Manager/TeamLeader only.' });
    }

    const tenant = await prisma.tenant.findUnique({
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
    };
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

    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { settings: true },
    });
    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    const settingsObject = asObject(tenant.settings);
    const salarySettings = asObject(settingsObject.salary);
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

    await prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: {
        settings: JSON.parse(JSON.stringify(nextSettings)),
      },
    });

    await prisma.auditLog.create({
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

  updateFixedSalaries: adminProcedure.input(updateFixedSalariesInput).mutation(async ({ ctx, input }) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { settings: true },
    });
    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    const requestedUserIds = Array.from(new Set(input.fixedSalaries.map((item) => item.userId)));
    const allowedAgents = requestedUserIds.length
      ? await prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          id: { in: requestedUserIds },
          isActive: true,
          roles: { has: 'Agent' },
        },
        select: { id: true },
      })
      : [];
    const allowedSet = new Set(allowedAgents.map((agent) => agent.id));
    const normalizedFixedSalaries = input.fixedSalaries
      .map((row) => ({
        userId: row.userId,
        amount: Math.max(0, Math.round(row.amount)),
      }))
      .filter((row) => allowedSet.has(row.userId) && row.amount > 0);

    const settingsObject = asObject(tenant.settings);
    const salarySettings = asObject(settingsObject.salary);
    const nextSettings = {
      ...settingsObject,
      salary: {
        ...salarySettings,
        fixedSalaries: normalizedFixedSalaries,
      },
    };

    await prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: {
        settings: JSON.parse(JSON.stringify(nextSettings)),
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        action: 'fixed_salaries_update',
        resource: 'tenant_settings',
        resourceId: ctx.tenantId,
      },
    });

    return { success: true };
  }),

  updateAttendancePenaltySettings: adminProcedure
    .input(updateAttendancePenaltySettingsInput)
    .mutation(async ({ ctx, input }) => {
      const tenant = await prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { settings: true },
      });
      if (!tenant) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
      }

      const settingsObject = asObject(tenant.settings);
      const salarySettings = asObject(settingsObject.salary);
      const nextSettings = {
        ...settingsObject,
        salary: {
          ...salarySettings,
          attendancePenaltySettings: {
            lateMinutePenaltyUZS: Math.max(0, Math.round(input.lateMinutePenaltyUZS)),
            missingHourPenaltyUZS: Math.max(0, Math.round(input.missingHourPenaltyUZS)),
            absenceDayPenaltyUZS: Math.max(0, Math.round(input.absenceDayPenaltyUZS)),
            applyToFixedSalary: input.applyToFixedSalary,
            applyToKpi: input.applyToKpi,
            latePenaltyTarget: input.latePenaltyTarget,
            missingHourPenaltyTarget: input.missingHourPenaltyTarget,
            absenceDayPenaltyTarget: input.absenceDayPenaltyTarget,
            monthlyPenaltyCapUZS: Math.max(0, Math.round(input.monthlyPenaltyCapUZS)),
          },
        },
      };

      await prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: {
          settings: JSON.parse(JSON.stringify(nextSettings)),
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'attendance_penalty_settings_update',
          resource: 'tenant_settings',
          resourceId: ctx.tenantId,
        },
      });

      return { success: true };
    }),

  listPlans: protectedProcedure.query(async ({ ctx }) => {
    if (!canReadBonusPlans(ctx.user.roles)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Bonus plans are available for Admin/Manager/TeamLeader only.' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { settings: true },
    });
    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    return {
      plans: parsePlanBonuses(tenant.settings),
    };
  }),

  catalogOptions: protectedProcedure.query(async ({ ctx }) => {
    if (!canReadBonusPlans(ctx.user.roles)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Bonus plan catalog is available for Admin/Manager/TeamLeader only.' });
    }

    const courses = await prisma.course.findMany({
      where: {
        tenantId: ctx.tenantId,
        isActive: true,
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        category: true,
        tariffs: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            subTariffs: {
              where: { isActive: true },
              orderBy: { name: 'asc' },
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    return {
      courses: courses.map((course) => ({
        id: course.id,
        name: course.name,
        category: String(course.category || '').trim().toLowerCase(),
        tariffs: course.tariffs.map((tariff) => ({
          id: tariff.id,
          name: tariff.name,
          subTariffs: tariff.subTariffs,
        })),
      })),
    };
  }),

  createPlan: adminProcedure.input(createPlanInput).mutation(async ({ ctx, input }) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { settings: true },
    });
    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    await validatePlanScope({
      tenantId: ctx.tenantId,
      courseCategory: input.courseCategory,
      courseId: input.courseId ?? null,
      tariffId: input.tariffId ?? null,
      subTariffId: input.tariffId ? (input.subTariffId ?? null) : null,
      subTariffName: input.tariffId ? null : (input.subTariffName ?? null),
    });

    const currentPlans = parsePlanBonuses(tenant.settings);
    const nowIso = new Date().toISOString();
    const newPlan: BonusPlan = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      isActive: input.isActive !== false,
      periodMode: input.periodMode,
      courseCategory: input.courseCategory,
      courseId: input.courseId ?? null,
      tariffId: input.tariffId ?? null,
      subTariffId: input.tariffId ? (input.subTariffId ?? null) : null,
      subTariffName: input.tariffId ? null : (input.subTariffName ? normalizeName(input.subTariffName) : null),
      targetClosedSales: Math.max(1, Math.floor(input.targetClosedSales)),
      bonusAmount: Math.max(1, Math.round(input.bonusAmount)),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const settingsPayload = mergeSalarySettings({
      currentSettings: tenant.settings,
      nextPlans: [...currentPlans, newPlan],
    });

    await prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: {
        settings: JSON.parse(JSON.stringify(settingsPayload)),
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        action: 'bonus_plan_create',
        resource: 'tenant_settings',
        resourceId: ctx.tenantId,
        metadata: {
          planId: newPlan.id,
          name: newPlan.name,
        },
      },
    });

    return { success: true, plan: newPlan };
  }),

  updatePlan: adminProcedure.input(updatePlanInput).mutation(async ({ ctx, input }) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { settings: true },
    });
    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    const currentPlans = parsePlanBonuses(tenant.settings);
    const targetIndex = currentPlans.findIndex((plan) => plan.id === input.id);
    if (targetIndex < 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Bonus plan not found.' });
    }

    const currentPlan = currentPlans[targetIndex] as BonusPlan;
    const nextPlan: BonusPlan = {
      ...currentPlan,
      ...(typeof input.name === 'string' ? { name: input.name.trim() } : {}),
      ...(typeof input.isActive === 'boolean' ? { isActive: input.isActive } : {}),
      ...(input.periodMode ? { periodMode: input.periodMode } : {}),
      ...(input.courseCategory ? { courseCategory: input.courseCategory } : {}),
      ...(input.courseId !== undefined ? { courseId: input.courseId } : {}),
      ...(input.tariffId !== undefined ? { tariffId: input.tariffId } : {}),
      ...(input.subTariffId !== undefined ? { subTariffId: input.subTariffId } : {}),
      ...(input.subTariffName !== undefined ? { subTariffName: input.subTariffName } : {}),
      ...(input.targetClosedSales !== undefined ? { targetClosedSales: Math.max(1, Math.floor(input.targetClosedSales)) } : {}),
      ...(input.bonusAmount !== undefined ? { bonusAmount: Math.max(1, Math.round(input.bonusAmount)) } : {}),
      updatedAt: new Date().toISOString(),
    };

    const normalizedNextPlan: BonusPlan = {
      ...nextPlan,
      subTariffId: nextPlan.tariffId ? nextPlan.subTariffId : null,
      subTariffName: nextPlan.tariffId
        ? null
        : (nextPlan.subTariffName ? normalizeName(nextPlan.subTariffName) : null),
    };

    await validatePlanScope({
      tenantId: ctx.tenantId,
      courseCategory: normalizedNextPlan.courseCategory,
      courseId: normalizedNextPlan.courseId,
      tariffId: normalizedNextPlan.tariffId,
      subTariffId: normalizedNextPlan.subTariffId,
      subTariffName: normalizedNextPlan.subTariffName,
    });

    const nextPlans = [...currentPlans];
    nextPlans[targetIndex] = normalizedNextPlan;

    const settingsPayload = mergeSalarySettings({
      currentSettings: tenant.settings,
      nextPlans,
    });

    await prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: {
        settings: JSON.parse(JSON.stringify(settingsPayload)),
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        action: 'bonus_plan_update',
        resource: 'tenant_settings',
        resourceId: ctx.tenantId,
        metadata: {
          planId: nextPlan.id,
          name: normalizedNextPlan.name,
        },
      },
    });

    return { success: true, plan: normalizedNextPlan };
  }),

  deletePlan: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tenant = await prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { settings: true },
      });
      if (!tenant) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
      }

      const currentPlans = parsePlanBonuses(tenant.settings);
      const deletedPlan = currentPlans.find((plan) => plan.id === input.id);
      if (!deletedPlan) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Bonus plan not found.' });
      }

      const nextPlans = currentPlans.filter((plan) => plan.id !== input.id);
      const settingsPayload = mergeSalarySettings({
        currentSettings: tenant.settings,
        nextPlans,
      });

      await prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: {
          settings: JSON.parse(JSON.stringify(settingsPayload)),
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'bonus_plan_delete',
          resource: 'tenant_settings',
          resourceId: ctx.tenantId,
          metadata: {
            planId: deletedPlan.id,
            name: deletedPlan.name,
          },
        },
      });

      return { success: true };
    }),
});
