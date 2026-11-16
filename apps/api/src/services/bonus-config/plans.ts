import type { DbClient } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';

import { asObjectOrEmpty } from '../../lib/object';
import { normalizeMatchText } from '../../lib/text';

import { BONUS_PLAN_CATEGORIES, BONUS_PLAN_PERIODS, type BonusPlan, type BonusPlanCategory, type BonusPlanPeriodMode } from './types';

function sanitizePlan(raw: unknown): BonusPlan | null {
  const row = asObjectOrEmpty(raw);
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

export function parsePlanBonuses(settings: unknown): BonusPlan[] {
  const settingsObject = asObjectOrEmpty(settings);
  const salarySettings = asObjectOrEmpty(settingsObject.salary);
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

export function mergeSalarySettings(params: {
  currentSettings: unknown;
  nextPlans: BonusPlan[];
}): Record<string, unknown> {
  const settingsObject = asObjectOrEmpty(params.currentSettings);
  const salarySettings = asObjectOrEmpty(settingsObject.salary);

  return {
    ...settingsObject,
    salary: {
      ...salarySettings,
      planBonuses: params.nextPlans,
    },
  };
}

export async function validatePlanScope(params: {
  tenantId: string;
  courseCategory: BonusPlanCategory;
  courseId: string | null;
  tariffId: string | null;
  subTariffId: string | null;
  subTariffName: string | null;
  db: DbClient;
}) {
  const { db } = params;

  const normalizedSubTariffName = params.subTariffName ? normalizeMatchText(params.subTariffName) : '';

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
    const course = await db.course.findFirst({
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
    const tariff = await db.tariff.findFirst({
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
    const subTariff = await db.subTariff.findFirst({
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
    const courseSubTariffs = await db.subTariff.findMany({
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

    const hasMatch = courseSubTariffs.some((item) => normalizeMatchText(item.name) === normalizedSubTariffName);

    if (!hasMatch) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: "Tanlangan kurs uchun subtarif topilmadi.",
      });
    }
  }
}
