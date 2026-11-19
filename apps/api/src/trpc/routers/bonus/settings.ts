import { AGENT_ROLES, TEAM_LEADER_ROLES } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';

import { resolveCallerDataScope } from '../../../lib/access';
import { loadTenantSettings, saveTenantSettings, withSalarySettings } from '../../../lib/tenant-settings';
import { isOnlineScopedAdmin, mergeFixedSalariesForUsers } from '../../../services/bonus-config/access';
import { parseFixedSalaries } from '../../../services/bonus-config/rules';
import { KPI_METRIC_KEYS, type KpiMetricKey, type KpiThreshold } from '../../../services/bonus-config/types';
import { adminProcedure, scopedAdminProcedure } from '../../trpc';

import { updateAttendancePenaltySettingsInput, updateFixedSalariesInput, updateKpiSettingsInput } from './schemas';

export const bonusSettingsProcedures = {
  // OnlineAdmin changes only the online group's fixed salaries; the others are kept as they are.
  updateFixedSalaries: scopedAdminProcedure.input(updateFixedSalariesInput).mutation(async ({ ctx, input }) => {
    const tenantSettings = await loadTenantSettings(ctx.db, ctx.tenantId);

    const requestedUserIds = Array.from(new Set(input.fixedSalaries.map((item) => item.userId)));
    const allowedAgents = requestedUserIds.length
      ? await ctx.db.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          id: { in: requestedUserIds },
          isActive: true,
          roles: { hasSome: [...AGENT_ROLES, ...TEAM_LEADER_ROLES] },
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

    const scopedUserIds = isOnlineScopedAdmin(ctx.user.roles)
      ? (await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db)).userIds
      : null;
    const nextSettings = withSalarySettings(tenantSettings, {
      fixedSalaries: scopedUserIds
        ? mergeFixedSalariesForUsers({ current: parseFixedSalaries(tenantSettings), requested: normalizedFixedSalaries, allowedUserIds: scopedUserIds })
        : normalizedFixedSalaries,
    });

    await saveTenantSettings({
      db: ctx.db,
      tenantId: ctx.tenantId,
      actorUserId: ctx.user.userId,
      settings: nextSettings,
      auditAction: 'fixed_salaries_update',
    });

    return { success: true };
  }),
  // KPI and attendance penalties are company-wide: Admin only (not OnlineAdmin).
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

      const tenantSettings = await loadTenantSettings(ctx.db, ctx.tenantId);

      const nextSettings = withSalarySettings(tenantSettings, {
        kpiSettings: {
          enabled: input.monthlyKpiAmount > 0 && selectedMetrics.length > 0,
          monthlyBudget: Math.max(0, Math.round(input.monthlyKpiAmount)),
          selectedMetrics,
          thresholds: normalizedThresholds,
        },
      });

      await saveTenantSettings({
        db: ctx.db,
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.userId,
        settings: nextSettings,
        auditAction: 'kpi_settings_update',
      });

      return { success: true };
    }),
  updateAttendancePenaltySettings: adminProcedure
    .input(updateAttendancePenaltySettingsInput)
    .mutation(async ({ ctx, input }) => {
      const tenantSettings = await loadTenantSettings(ctx.db, ctx.tenantId);

      const nextSettings = withSalarySettings(tenantSettings, {
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
      });

      await saveTenantSettings({
        db: ctx.db,
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.userId,
        settings: nextSettings,
        auditAction: 'attendance_penalty_settings_update',
      });

      return { success: true };
    }),
};
