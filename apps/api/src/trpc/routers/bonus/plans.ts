import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { loadTenantSettings, saveTenantSettings } from '../../../lib/tenant-settings';
import { normalizeMatchText } from '../../../lib/text';
import { mergeSalarySettings, parsePlanBonuses, validatePlanScope } from '../../../services/bonus-config/plans';
import { type BonusPlan, canReadBonusPlans } from '../../../services/bonus-config/types';
import { loadActiveCourseCatalog } from '../../../services/course-sales/catalog';
import { adminProcedure, protectedProcedure } from '../../trpc';

import { createPlanInput, updatePlanInput } from './schemas';

export const bonusPlanProcedures = {
  listPlans: protectedProcedure.query(async ({ ctx }) => {
    if (!canReadBonusPlans(ctx.user.roles)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Bonus plans are available for Admin/Manager/TeamLeader only.' });
    }

    const tenantSettings = await loadTenantSettings(ctx.db, ctx.tenantId);

    return {
      plans: parsePlanBonuses(tenantSettings),
    };
  }),
  catalogOptions: protectedProcedure.query(async ({ ctx }) => {
    if (!canReadBonusPlans(ctx.user.roles)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Bonus plan catalog is available for Admin/Manager/TeamLeader only.' });
    }

    return {
      courses: await loadActiveCourseCatalog({ db: ctx.db, tenantId: ctx.tenantId }),
    };
  }),
  createPlan: adminProcedure.input(createPlanInput).mutation(async ({ ctx, input }) => {
    const tenantSettings = await loadTenantSettings(ctx.db, ctx.tenantId);

    await validatePlanScope({
      tenantId: ctx.tenantId,
      courseCategory: input.courseCategory,
      courseId: input.courseId ?? null,
      tariffId: input.tariffId ?? null,
      subTariffId: input.tariffId ? (input.subTariffId ?? null) : null,
      subTariffName: input.tariffId ? null : (input.subTariffName ?? null),
      db: ctx.db,
    });

    const currentPlans = parsePlanBonuses(tenantSettings);
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
      currentSettings: tenantSettings,
      nextPlans: [...currentPlans, newPlan],
    });

    await saveTenantSettings({
      db: ctx.db,
      tenantId: ctx.tenantId,
      actorUserId: ctx.user.userId,
      settings: settingsPayload,
      auditAction: 'bonus_plan_create',
      auditMetadata: {
        planId: newPlan.id,
        name: newPlan.name,
      },
    });

    return { success: true, plan: newPlan };
  }),
  updatePlan: adminProcedure.input(updatePlanInput).mutation(async ({ ctx, input }) => {
    const tenantSettings = await loadTenantSettings(ctx.db, ctx.tenantId);

    const currentPlans = parsePlanBonuses(tenantSettings);
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
      currentSettings: tenantSettings,
      nextPlans,
    });

    await saveTenantSettings({
      db: ctx.db,
      tenantId: ctx.tenantId,
      actorUserId: ctx.user.userId,
      settings: settingsPayload,
      auditAction: 'bonus_plan_update',
      auditMetadata: {
        planId: nextPlan.id,
        name: normalizedNextPlan.name,
      },
    });

    return { success: true, plan: normalizedNextPlan };
  }),
  deletePlan: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const tenantSettings = await loadTenantSettings(ctx.db, ctx.tenantId);

      const currentPlans = parsePlanBonuses(tenantSettings);
      const deletedPlan = currentPlans.find((plan) => plan.id === input.id);

      if (!deletedPlan) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Bonus plan not found.' });
      }

      const nextPlans = currentPlans.filter((plan) => plan.id !== input.id);
      const settingsPayload = mergeSalarySettings({
        currentSettings: tenantSettings,
        nextPlans,
      });

      await saveTenantSettings({
        db: ctx.db,
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.userId,
        settings: settingsPayload,
        auditAction: 'bonus_plan_delete',
        auditMetadata: {
          planId: deletedPlan.id,
          name: deletedPlan.name,
        },
      });

      return { success: true };
    }),
};
