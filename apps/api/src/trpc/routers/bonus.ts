import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, protectedProcedure, router } from '../trpc';

const BONUS_PLAN_CATEGORIES = ['online', 'offline', 'intensive', 'additional_service'] as const;
const BONUS_PLAN_PERIODS = ['monthly', 'all_time'] as const;
const BONUS_READ_ROLES = new Set(['Admin', 'Manager']);

type BonusPlanCategory = (typeof BONUS_PLAN_CATEGORIES)[number];
type BonusPlanPeriodMode = (typeof BONUS_PLAN_PERIODS)[number];

type BonusPlan = {
  id: string;
  name: string;
  isActive: boolean;
  periodMode: BonusPlanPeriodMode;
  courseCategory: BonusPlanCategory;
  courseId: string | null;
  tariffId: string | null;
  subTariffId: string | null;
  targetClosedSales: number;
  bonusAmount: number;
  createdAt: string;
  updatedAt: string;
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

function sanitizePlan(raw: unknown): BonusPlan | null {
  const row = asObject(raw);
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  const periodMode = typeof row.periodMode === 'string' ? row.periodMode.trim() : '';
  const courseCategory = typeof row.courseCategory === 'string' ? row.courseCategory.trim() : '';
  const courseId = typeof row.courseId === 'string' && row.courseId.trim() ? row.courseId.trim() : null;
  const tariffId = typeof row.tariffId === 'string' && row.tariffId.trim() ? row.tariffId.trim() : null;
  const subTariffId = typeof row.subTariffId === 'string' && row.subTariffId.trim() ? row.subTariffId.trim() : null;
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
}) {
  if (!params.courseId && (params.tariffId || params.subTariffId)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: "Tarif/Subtarif tanlash uchun avval kurs tanlang.",
    });
  }
  if (!params.tariffId && params.subTariffId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: "Subtarif tanlash uchun avval tarif tanlang.",
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
}

const createPlanInput = z.object({
  name: z.string().min(1).max(120),
  isActive: z.boolean().optional(),
  periodMode: z.enum(BONUS_PLAN_PERIODS),
  courseCategory: z.enum(BONUS_PLAN_CATEGORIES),
  courseId: z.string().uuid().nullable().optional(),
  tariffId: z.string().uuid().nullable().optional(),
  subTariffId: z.string().uuid().nullable().optional(),
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
  targetClosedSales: z.number().int().positive().optional(),
  bonusAmount: z.number().int().positive().optional(),
});

export const bonusRouter = router({
  listPlans: protectedProcedure.query(async ({ ctx }) => {
    if (!canReadBonusPlans(ctx.user.roles)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Bonus plans are available for Admin/Manager only.' });
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
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Bonus plan catalog is available for Admin/Manager only.' });
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
      subTariffId: input.subTariffId ?? null,
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
      subTariffId: input.subTariffId ?? null,
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
      ...(input.targetClosedSales !== undefined ? { targetClosedSales: Math.max(1, Math.floor(input.targetClosedSales)) } : {}),
      ...(input.bonusAmount !== undefined ? { bonusAmount: Math.max(1, Math.round(input.bonusAmount)) } : {}),
      updatedAt: new Date().toISOString(),
    };

    await validatePlanScope({
      tenantId: ctx.tenantId,
      courseCategory: nextPlan.courseCategory,
      courseId: nextPlan.courseId,
      tariffId: nextPlan.tariffId,
      subTariffId: nextPlan.subTariffId,
    });

    const nextPlans = [...currentPlans];
    nextPlans[targetIndex] = nextPlan;

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
          name: nextPlan.name,
        },
      },
    });

    return { success: true, plan: nextPlan };
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

