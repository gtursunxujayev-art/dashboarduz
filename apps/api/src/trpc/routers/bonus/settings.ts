import { AGENT_ROLES } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';

import { asObjectOrEmpty } from '../../../lib/object';
import { KPI_METRIC_KEYS, type KpiMetricKey, type KpiThreshold } from '../../../services/bonus-config/types';
import { adminProcedure } from '../../trpc';

import { updateAttendancePenaltySettingsInput, updateFixedSalariesInput, updateKpiSettingsInput } from './schemas';

export const bonusSettingsProcedures = {
  updateFixedSalaries: adminProcedure.input(updateFixedSalariesInput).mutation(async ({ ctx, input }) => {
    const tenant = await ctx.db.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { settings: true },
    });

    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    const requestedUserIds = Array.from(new Set(input.fixedSalaries.map((item) => item.userId)));
    const allowedAgents = requestedUserIds.length
      ? await ctx.db.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          id: { in: requestedUserIds },
          isActive: true,
          roles: { hasSome: [...AGENT_ROLES, 'TeamLeader'] },
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

    const settingsObject = asObjectOrEmpty(tenant.settings);
    const salarySettings = asObjectOrEmpty(settingsObject.salary);
    const nextSettings = {
      ...settingsObject,
      salary: {
        ...salarySettings,
        fixedSalaries: normalizedFixedSalaries,
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
        action: 'fixed_salaries_update',
        resource: 'tenant_settings',
        resourceId: ctx.tenantId,
      },
    });

    return { success: true };
  }),
  updateKpiSettings: adminProcedure
    .input(updateKpiSettingsInput)
    .mutation(async ({ ctx, input }) => {
      const selectedMetrics = Array.from(new Set(input.selectedMetrics));

      if (!selectedMetrics.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "Kamida bitta KPI ko'rsatkichini tanlang." });
      }
      if (selectedMetrics.length > 4) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "KPI uchun ko'pi bilan 4 ta ko'rsatkich tanlanadi." });
      }

      const normalizedThresholds = KPI_METRIC_KEYS.reduce((acc, metric) => {
        const raw = input.thresholds[metric];

        acc[metric] = {
          full: Math.max(0, Number(raw?.full ?? 0)),
          half: Math.max(0, Number(raw?.half ?? 0)),
        };

        return acc;
      }, {} as Record<KpiMetricKey, KpiThreshold>);

      for (const metric of selectedMetrics) {
        const threshold = normalizedThresholds[metric];

        if (!threshold || threshold.full <= 0 || threshold.half <= 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Tanlangan KPI (${metric}) uchun full/half threshold 0 dan katta bo'lishi kerak.`,
          });
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
      const nextSettings = {
        ...settingsObject,
        salary: {
          ...salarySettings,
          kpiSettings: {
            enabled: input.monthlyKpiAmount > 0 && selectedMetrics.length > 0,
            monthlyBudget: Math.max(0, Math.round(input.monthlyKpiAmount)),
            selectedMetrics,
            thresholds: normalizedThresholds,
          },
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
          action: 'kpi_settings_update',
          resource: 'tenant_settings',
          resourceId: ctx.tenantId,
        },
      });

      return { success: true };
    }),
  updateAttendancePenaltySettings: adminProcedure
    .input(updateAttendancePenaltySettingsInput)
    .mutation(async ({ ctx, input }) => {
      const tenant = await ctx.db.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { settings: true },
      });

      if (!tenant) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
      }

      const settingsObject = asObjectOrEmpty(tenant.settings);
      const salarySettings = asObjectOrEmpty(settingsObject.salary);
      const nextSettings = {
        ...settingsObject,
        salary: {
          ...salarySettings,
          attendancePenaltySettings: {
            lateMinutePenaltyUZS: Math.max(0, Math.round(input.lateMinutePenaltyUZS)),
            missingHourPenaltyUZS: Math.max(0, Math.round(input.missingHourPenaltyUZS)),
            absenceDayPenaltyUZS: Math.max(0, Math.round(input.absenceDayPenaltyUZS)),
            applyToFixedSalary: input.applyToFixedSalary || Math.max(0, Math.round(input.absenceDayPenaltyUZS)) > 0,
            applyToKpi: input.applyToKpi,
            latePenaltyTarget: input.latePenaltyTarget,
            missingHourPenaltyTarget: input.missingHourPenaltyTarget,
            absenceDayPenaltyTarget: 'fixed',
            monthlyPenaltyCapUZS: Math.max(0, Math.round(input.monthlyPenaltyCapUZS)),
          },
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
          action: 'attendance_penalty_settings_update',
          resource: 'tenant_settings',
          resourceId: ctx.tenantId,
        },
      });

      return { success: true };
    }),
};
