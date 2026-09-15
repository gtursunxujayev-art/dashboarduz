import {
  amocrmService,
  asObject,
  asStringArray,
  extractLeadValue,
  getAgentResponsibleScope,
  getRangeStart,
  getTenantAmoCRMContext,
  isMappedValue,
  prisma,
  protectedProcedure,
} from './helpers';

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

export function calculateLeadPeriods(params: {
  leads: any[];
  now: Date;
  dayStart: Date;
  weekStart: Date;
  monthStart: Date;
  reasonFieldKey: string | null;
  qualifiedValues: string[];
  nonQualifiedValues: string[];
  qualifiedStageIds: string[];
}) {
  const daily = emptyPeriod();
  const weekly = emptyPeriod();
  const monthly = emptyPeriod();
  const earliestStart = params.weekStart < params.monthStart ? params.weekStart : params.monthStart;
  for (const lead of params.leads) {
    const createdAt = leadCreatedAt(lead.created_at);
    if (!createdAt || createdAt < earliestStart || createdAt > params.now) continue;

    const reasonValue = extractLeadValue(lead, params.reasonFieldKey);
    const stageId = lead.status_id === null || lead.status_id === undefined ? null : String(lead.status_id);
    const qualified = params.qualifiedStageIds.length > 0
      ? Boolean(stageId && params.qualifiedStageIds.includes(stageId))
      : isMappedValue(reasonValue, params.qualifiedValues);
    const nonQualified = params.nonQualifiedValues.length > 0
      && isMappedValue(reasonValue, params.nonQualifiedValues);

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
    const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);
    if (scope.isScoped && !scope.responsibleUserId) {
      return {
        available: false,
        reason: 'mapping_missing' as const,
        daily: emptyPeriod(),
        weekly: emptyPeriod(),
        monthly: emptyPeriod(),
      };
    }

    const [tenant, amoContext] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } }),
      getTenantAmoCRMContext(ctx.tenantId),
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

    const tenantSettings = asObject(tenant?.settings) ?? {};
    const dashboardSettings = asObject(tenantSettings.dashboard) ?? {};
    const reasonFieldKey = typeof dashboardSettings.reasonFieldKey === 'string'
      ? dashboardSettings.reasonFieldKey
      : null;
    const qualifiedValues = asStringArray(dashboardSettings.qualifiedValues);
    const nonQualifiedValues = asStringArray(dashboardSettings.nonQualifiedValues);
    const qualifiedStageIds = asStringArray(dashboardSettings.qualifiedStageIds);
    const monthStart = getRangeStart('month', now);
    const weekStart = getRangeStart('week', now);
    const dayStart = getRangeStart('today', now);
    const fetchStart = weekStart < monthStart ? weekStart : monthStart;

    try {
      // Deliberately omit pipelineIds: these fixed overview cards cover all pipelines.
      const leads = await amocrmService.fetchAllLeads(
        amoContext.accessToken,
        {
          responsibleUserIds: scope.isScoped ? [scope.responsibleUserId as string] : undefined,
          createdAtFrom: fetchStart,
          createdAtTo: now,
          limit: 250,
        },
        amoContext.baseUrl,
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
    } catch (error: any) {
      const message = String(error?.message || error).toLowerCase();
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
