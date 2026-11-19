import { resolveCallerDataScope } from '../../../lib/access';
import { getRangeStart } from '../../../lib/dates';
import { asObject } from '../../../lib/object';
import { readDashboardSettings } from '../../../services/dashboard/dashboard-settings';
import { canQueryScopedLeads, scopedResponsibleIds } from '../../../services/dashboard/data-scope';
import { classifyLeadQualification, type LeadQualificationRules } from '../../../services/dashboard/lead-qualification';
import type { AmoCRMLead } from '../../../services/integrations/amocrm';
import { getAmoLeads } from '../../../services/integrations/amocrm-lead-snapshot-read';

import { getTenantAmoCRMContext, protectedProcedure } from './helpers';

type LeadPeriod = {
  total: number;
  qualified: number;
  nonQualified: number;
};

function leadCreatedAt(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(value > 1_000_000_000_000 ? value : value * 1000);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'string') {
    const numeric = Number(value);

    if (Number.isFinite(numeric)) return leadCreatedAt(numeric);
    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function emptyPeriod(): LeadPeriod {
  return { total: 0, qualified: 0, nonQualified: 0 };
}

export function calculateLeadPeriods(params: LeadQualificationRules & {
  leads: AmoCRMLead[];
  now: Date;
  dayStart: Date;
  weekStart: Date;
  monthStart: Date;
}) {
  const daily = emptyPeriod();
  const weekly = emptyPeriod();
  const monthly = emptyPeriod();
  const earliestStart = params.weekStart < params.monthStart ? params.weekStart : params.monthStart;

  for (const lead of params.leads) {
    const createdAt = leadCreatedAt(lead.created_at);

    if (!createdAt || createdAt < earliestStart || createdAt > params.now) continue;

    const { qualified, nonQualified } = classifyLeadQualification(lead, params);

    for (const [start, period] of [
      [params.monthStart, monthly],
      [params.weekStart, weekly],
      [params.dayStart, daily],
    ] as const) {
      if (createdAt < start) continue;
      period.total += 1;
      if (qualified) period.qualified += 1;
      if (nonQualified) period.nonQualified += 1;
    }
  }

  return { daily, weekly, monthly };
}

export const leadOverviewProcedures = {
  leadOverview: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date();
    // Agents count their own leads, team leaders / OnlineAdmin their group's; nobody linked to amoCRM = nothing to show.
    const scope = await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);

    if (!canQueryScopedLeads(scope)) {
      return {
        available: false,
        reason: 'mapping_missing' as const,
        daily: emptyPeriod(),
        weekly: emptyPeriod(),
        monthly: emptyPeriod(),
      };
    }

    const [tenant, amoContext] = await Promise.all([
      ctx.db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } }),
      getTenantAmoCRMContext(ctx.tenantId, ctx.db),
    ]);

    if (!amoContext) {
      return {
        available: false,
        reason: 'amo_unavailable' as const,
        daily: emptyPeriod(),
        weekly: emptyPeriod(),
        monthly: emptyPeriod(),
      };
    }

    const { reasonFieldKey, qualifiedValues, nonQualifiedValues, qualifiedStageIds } = readDashboardSettings(tenant?.settings);
    const monthStart = getRangeStart('month', now);
    const weekStart = getRangeStart('week', now);
    const dayStart = getRangeStart('today', now);
    const fetchStart = weekStart < monthStart ? weekStart : monthStart;

    try {
      // Deliberately omit pipelineIds: these fixed overview cards cover all pipelines.
      const leads = await getAmoLeads(
        ctx.tenantId,
        {
          responsibleUserIds: scopedResponsibleIds(scope),
          createdAtFrom: fetchStart,
          createdAtTo: now,
        },
        amoContext,
        ctx.db,
      );

      const { daily, weekly, monthly } = calculateLeadPeriods({
        leads,
        now,
        dayStart,
        weekStart,
        monthStart,
        reasonFieldKey,
        qualifiedValues,
        nonQualifiedValues,
        qualifiedStageIds,
      });

      return { available: true, reason: null, daily, weekly, monthly };
    } catch (error: unknown) {
      const message = String(asObject(error)?.message || error).toLowerCase();

      return {
        available: false,
        reason: message.includes('timeout') ? 'timeout' as const : 'fetch_failed' as const,
        daily: emptyPeriod(),
        weekly: emptyPeriod(),
        monthly: emptyPeriod(),
      };
    }
  }),
};
