import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { normalizeMatchText } from '../../../lib/text';
import { mergeSalarySettings, parsePlanBonuses, validatePlanScope } from '../../../services/bonus-config/plans';
import { type BonusPlan, canReadBonusPlans } from '../../../services/bonus-config/types';
import { adminProcedure, protectedProcedure } from '../../trpc';

import { createPlanInput, updatePlanInput } from './schemas';

export const bonusPlanProcedures = {
  listPlans: protectedProcedure.query(async ({ ctx }) => {
    if (!canReadBonusPlans(ctx.user.roles)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Bonus plans are available for Admin/Manager/TeamLeader only.' });
    }

    const tenant = await ctx.db.tenant.findUnique({
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

    const courses = await ctx.db.course.findMany({
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
    const tenant = await ctx.db.tenant.findUnique({
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
      db: ctx.db,
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
      subTariffName: input.tariffId ? null : (input.subTariffName ? normalizeMatchText(input.subTariffName) : null),
      targetClosedSales: Math.max(1, Math.floor(input.targetClosedSales)),
      bonusAmount: Math.max(1, Math.round(input.bonusAmount)),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const settingsPayload = mergeSalarySettings({
      currentSettings: tenant.settings,
      nextPlans: [...currentPlans, newPlan],
    });

    await ctx.db.tenant.update({
      where: { id: ctx.tenantId },
      data: {
        settings: JSON.parse(JSON.stringify(settingsPayload)),
      },
    });

    await ctx.db.auditLog.create({
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
    const tenant = await ctx.db.tenant.findUnique({
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
        : (nextPlan.subTariffName ? normalizeMatchText(nextPlan.subTariffName) : null),
    };

    await validatePlanScope({
      tenantId: ctx.tenantId,
      courseCategory: normalizedNextPlan.courseCategory,
      courseId: normalizedNextPlan.courseId,
      tariffId: normalizedNextPlan.tariffId,
      subTariffId: normalizedNextPlan.subTariffId,
      subTariffName: normalizedNextPlan.subTariffName,
      db: ctx.db,
    });

    const nextPlans = [...currentPlans];

    nextPlans[targetIndex] = normalizedNextPlan;

    const settingsPayload = mergeSalarySettings({
      currentSettings: tenant.settings,
      nextPlans,
    });

    await ctx.db.tenant.update({
      where: { id: ctx.tenantId },
      data: {
        settings: JSON.parse(JSON.stringify(settingsPayload)),
      },
    });

    await ctx.db.auditLog.create({
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
      const tenant = await ctx.db.tenant.findUnique({
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

      await ctx.db.tenant.update({
        where: { id: ctx.tenantId },
        data: {
          settings: JSON.parse(JSON.stringify(settingsPayload)),
        },
      });

      await ctx.db.auditLog.create({
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
};
