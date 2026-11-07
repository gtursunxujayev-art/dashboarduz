// Tahlil → Voronka: per-manager funnel (leads, calls, sales, plan) and lost-revenue analysis.
import { AGENT_ROLES } from '@dashboarduz/shared';
import type { Prisma } from '@prisma/client';

import { buildCacheKey, getOrSet } from '../../services/cache';
import {
  AMO_LOST_STATUS_ID,
  AMO_WON_STATUS_ID,
  bucketLeadsByResponsible,
  buildStageSortIndex,
  computeLostRevenueRow,
  computeTeamRatios,
  safeDiv,
  sumFunnelRows,
  sumLostRevenueRows,
  type FunnelManagerRow,
  type FunnelPipeline,
  type FunnelStageRef,
  type LeadBuckets,
} from '../../services/funnel-metrics';
import {
  excludeTechnicalRows,
  loadTechnicalSaleIdsForRows,
  resolveSaleAgreementAmount,
} from '../../services/income-facts';

import {
  amocrmService,
  asObject,
  dashboardRangeSchema,
  getAgentResponsibleScope,
  getTenantAmoCRMContext,
  INCOME_LIFECYCLE_ACTIVE,
  isAllowedUtelManagerExtension,
  isMissingUserMappingColumnError,
  isTashkiliyOnly,
  log,
  LogLevel,
  normalizeDigits,
  prisma,
  protectedProcedure,
  resolveCallExtension,
  resolveDateRange,
  router,
  toFiniteNumber,
  TRPCError,
  z,
} from './dashboard/helpers';
import { resolveAgentGroup } from './dashboard/live-leaderboard';

const funnelGroupSchema = z.enum(['all', 'online', 'offline']);
const stageRefSchema = z.object({ pipelineId: z.string().min(1), statusId: z.string().min(1) });
const PLAN_EDITOR_ROLES = ['Admin', 'Manager'];
const LEADS_PAGE_SIZE = 250;
const LEADS_MAX_PAGES = 40;
const LEADS_TIMEOUT_MS = 15_000;

type FunnelSourceState = 'ok' | 'partial' | 'unavailable' | 'timeout';
type FunnelSourceStatus = { leads: { ok: boolean; reason: string | null; state: FunnelSourceState } };

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, reason: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(reason)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function detectLeadsFailureReason(error: unknown): string {
  const message = String((error as Error | undefined)?.message || '').toLowerCase();

  if (message.includes('failed to decrypt integration tokens')) return 'decrypt_failed';
  if (message.includes('timeout')) return 'timeout';
  if (!message.startsWith('failed to fetch amocrm') && (message.includes('network') || message.includes('fetch failed'))) {
    return 'network_error';
  }

  return 'fetch_failed';
}

async function loadFunnelPipelines(tenantId: string): Promise<{ connected: boolean; pipelines: FunnelPipeline[] }> {
  return getOrSet(buildCacheKey('funnelStages', { t: tenantId }), 600, async () => {
    const amoContext = await getTenantAmoCRMContext(tenantId);

    if (!amoContext) {
      return { connected: false, pipelines: [] };
    }
    let response;

    try {
      response = await amocrmService.fetchPipelines(amoContext.accessToken, amoContext.baseUrl);
    } catch {
      response = await amocrmService.fetchPipelines(amoContext.accessToken, amoContext.baseUrl);
    }
    const selected = new Set((amoContext.selectedPipelineIds || []).map(String));
    const rawPipelines = Array.isArray(response._embedded?.pipelines) ? response._embedded.pipelines : [];
    const pipelines: FunnelPipeline[] = rawPipelines
      .map((pipeline, pipelineIndex) => {
        const rawStatuses = Array.isArray(pipeline._embedded?.statuses) ? pipeline._embedded.statuses : [];

        return {
          id: String(pipeline.id ?? ''),
          name: pipeline.name || `Voronka ${pipeline.id ?? ''}`,
          sort: Number.isFinite(Number(pipeline.sort)) ? Number(pipeline.sort) : pipelineIndex,
          statuses: rawStatuses
            .map((status, statusIndex) => ({
              id: String(status.id ?? ''),
              name: status.name || String(status.id ?? ''),
              sort: Number.isFinite(Number(status.sort)) ? Number(status.sort) : statusIndex,
            }))
            .filter((status) => status.id && status.id !== AMO_WON_STATUS_ID && status.id !== AMO_LOST_STATUS_ID)
            .sort((a, b) => a.sort - b.sort),
        };
      })
      .filter((pipeline) => pipeline.id && (selected.size === 0 || selected.has(pipeline.id)))
      .sort((a, b) => a.sort - b.sort);

    return { connected: true, pipelines };
  });
}

function extractFunnelPlans(settings: unknown): Map<string, number> {
  const plans = asObject(asObject(asObject(settings)?.funnel)?.plans) || {};
  const result = new Map<string, number>();

  for (const [userId, value] of Object.entries(plans)) {
    const plan = Math.max(0, Math.round(toFiniteNumber(value, 0)));

    if (userId && plan > 0) result.set(userId, plan);
  }

  return result;
}

type FunnelAgent = {
  id: string;
  name: string | null;
  username: string | null;
  roles: string[];
  amocrmResponsibleUserId: string | null;
  utelManagerExternalId: string | null;
};

async function loadFunnelAgents(tenantId: string, group: z.infer<typeof funnelGroupSchema>): Promise<FunnelAgent[]> {
  const where = {
    tenantId,
    isActive: true,
    roles: { hasSome: [...AGENT_ROLES, 'TeamLeader'] },
  };
  let agents: FunnelAgent[];

  try {
    agents = await prisma.user.findMany({
      where,
      orderBy: [{ name: 'asc' }, { username: 'asc' }],
      select: {
        id: true,
        name: true,
        username: true,
        roles: true,
        amocrmResponsibleUserId: true,
        utelManagerExternalId: true,
      },
    });
  } catch (error) {
    if (!isMissingUserMappingColumnError(error)) throw error;
    const fallback = await prisma.user.findMany({
      where,
      orderBy: [{ name: 'asc' }, { username: 'asc' }],
      select: { id: true, name: true, username: true, roles: true },
    });

    agents = fallback.map((user) => ({ ...user, amocrmResponsibleUserId: null, utelManagerExternalId: null }));
  }
  if (group === 'all') return agents;

  return agents.filter((agent) => resolveAgentGroup(agent.roles) === group);
}

function agentLabel(agent: { name: string | null; username: string | null }): string {
  return agent.name?.trim() || agent.username?.trim() || 'Menejer';
}

type FunnelBaseResult = {
  sourceStatus: FunnelSourceStatus;
  unmappedManagerNames: string[];
  rows: FunnelManagerRow[];
};

async function buildFunnelBase(params: {
  tenantId: string;
  rangeStart: Date;
  rangeEnd: Date;
  group: z.infer<typeof funnelGroupSchema>;
  ishlanganStage: FunnelStageRef | null;
  taklifStage: FunnelStageRef | null;
}): Promise<FunnelBaseResult> {
  const { tenantId, rangeStart, rangeEnd } = params;
  const agents = await loadFunnelAgents(tenantId, params.group);
  const agentIds = agents.map((agent) => agent.id);
  const sourceStatus: FunnelSourceStatus = { leads: { ok: true, reason: null, state: 'ok' } };

  const extensionToUserId = new Map<string, string>();

  for (const agent of agents) {
    const extension = normalizeDigits(agent.utelManagerExternalId);

    if (isAllowedUtelManagerExtension(extension) && !extensionToUserId.has(extension)) {
      extensionToUserId.set(extension, agent.id);
    }
  }
  const extensions = Array.from(extensionToUserId.keys());

  const loadLeads = async (): Promise<Array<Record<string, unknown>> | null> => {
    let amoContext;

    try {
      amoContext = await getTenantAmoCRMContext(tenantId);
    } catch (error) {
      sourceStatus.leads = { ok: false, reason: detectLeadsFailureReason(error), state: 'unavailable' };

      return null;
    }
    if (!amoContext) {
      sourceStatus.leads = { ok: false, reason: 'amo_unavailable', state: 'unavailable' };

      return null;
    }
    const run = () => withTimeout(
      amocrmService.fetchAllLeads(
        amoContext.accessToken,
        {
          pipelineIds: amoContext.selectedPipelineIds,
          createdAtFrom: rangeStart,
          createdAtTo: rangeEnd,
          limit: LEADS_PAGE_SIZE,
          maxPages: LEADS_MAX_PAGES,
        },
        amoContext.baseUrl,
      ),
      LEADS_TIMEOUT_MS,
      'amo_leads_timeout',
    );

    try {
      let leads;

      try {
        leads = await run();
      } catch {
        leads = await run();
      }
      if (leads.length >= LEADS_PAGE_SIZE * LEADS_MAX_PAGES) {
        sourceStatus.leads = { ok: false, reason: 'page_cap', state: 'partial' };
      }

      return leads as Array<Record<string, unknown>>;
    } catch (error) {
      const reason = detectLeadsFailureReason(error);

      sourceStatus.leads = { ok: false, reason, state: reason === 'timeout' ? 'timeout' : 'unavailable' };
      log(LogLevel.WARN, 'Funnel: amoCRM leads unavailable', {
        tenantId,
        reason,
        error: String((error as Error | undefined)?.message || error),
      });

      return null;
    }
  };

  const [leads, pipelinesResult, calls, salesRaw] = await Promise.all([
    loadLeads(),
    params.ishlanganStage || params.taklifStage
      ? loadFunnelPipelines(tenantId).catch(() => ({ connected: false, pipelines: [] as FunnelPipeline[] }))
      : Promise.resolve({ connected: true, pipelines: [] as FunnelPipeline[] }),
    extensions.length
      ? prisma.call.findMany({
          where: {
            tenantId,
            provider: 'utel',
            startedAt: { gte: rangeStart, lte: rangeEnd },
            OR: [{ from: { in: extensions } }, { to: { in: extensions } }],
          },
          select: { from: true, to: true, direction: true, metadata: true },
        })
      : Promise.resolve([]),
    agentIds.length
      ? prisma.income.findMany({
          where: {
            tenantId,
            type: 'new_sale',
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: { gte: rangeStart, lte: rangeEnd },
            managerUserId: { in: agentIds },
          },
          select: {
            id: true,
            type: true,
            relatedDebtIncomeId: true,
            managerUserId: true,
            paymentAmount: true,
            coursePriceAmount: true,
            debtAmount: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const stageIndex = buildStageSortIndex(pipelinesResult.pipelines);
  const leadBuckets = leads
    ? bucketLeadsByResponsible(
        leads as Parameters<typeof bucketLeadsByResponsible>[0],
        { ishlangan: params.ishlanganStage, taklif: params.taklifStage },
        stageIndex,
      )
    : new Map<string, LeadBuckets>();

  const callsByUserId = new Map<string, number>();

  for (const call of calls) {
    const extension = resolveCallExtension(call);
    const userId = extension ? extensionToUserId.get(extension) : undefined;

    if (userId) callsByUserId.set(userId, (callsByUserId.get(userId) || 0) + 1);
  }

  const technicalSaleIds = await loadTechnicalSaleIdsForRows(tenantId, salesRaw);
  const sales = excludeTechnicalRows(salesRaw, technicalSaleIds);
  const salesByUserId = new Map<string, { sales: number; agreementSum: number }>();

  for (const sale of sales) {
    if (!sale.managerUserId) continue;
    const current = salesByUserId.get(sale.managerUserId) || { sales: 0, agreementSum: 0 };

    current.sales += 1;
    current.agreementSum += resolveSaleAgreementAmount(sale);
    salesByUserId.set(sale.managerUserId, current);
  }

  const unmappedManagerNames: string[] = [];
  const rows: FunnelManagerRow[] = agents.map((agent) => {
    const amoId = agent.amocrmResponsibleUserId ? String(agent.amocrmResponsibleUserId).trim() : '';

    if (!amoId) unmappedManagerNames.push(agentLabel(agent));
    const bucket = amoId ? leadBuckets.get(amoId) : undefined;
    const leadsKnown = Boolean(leads) && Boolean(amoId);
    const saleStats = salesByUserId.get(agent.id) || { sales: 0, agreementSum: 0 };

    return {
      userId: agent.id,
      name: agentLabel(agent),
      assignedLeads: leadsKnown ? (bucket?.assigned ?? 0) : null,
      ishlanganLeads: leadsKnown ? (bucket?.ishlangan ?? 0) : null,
      taklifLeads: leadsKnown ? (bucket?.taklif ?? 0) : null,
      calls: callsByUserId.get(agent.id) || 0,
      sales: saleStats.sales,
      agreementSum: saleStats.agreementSum,
      avgCheck: safeDiv(saleStats.agreementSum, saleStats.sales),
      plan: 0,
    };
  });

  rows.sort((a, b) => a.name.localeCompare(b.name, 'uz'));

  return { sourceStatus, unmappedManagerNames, rows };
}

export const funnelRouter = router({
  stageOptions: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await loadFunnelPipelines(ctx.tenantId);
    } catch (error) {
      log(LogLevel.WARN, 'Funnel: amoCRM pipelines unavailable', {
        tenantId: ctx.tenantId,
        error: String((error as Error | undefined)?.message || error),
      });

      return { connected: false, pipelines: [] as FunnelPipeline[] };
    }
  }),

  summary: protectedProcedure
    .input(
      z.object({
        range: dashboardRangeSchema,
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        group: funnelGroupSchema.default('all'),
        ishlanganStage: stageRefSchema.nullable().optional(),
        taklifStage: stageRefSchema.nullable().optional(),
        refreshKey: z.number().int().nonnegative().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const ishlanganStage = input.ishlanganStage ?? null;
      const taklifStage = input.taklifStage ?? null;

      const cacheKey = buildCacheKey('funnel', {
        t: ctx.tenantId,
        r: input.range,
        df: input.dateFrom,
        dt: input.dateTo,
        g: input.group,
        is: ishlanganStage ? `${ishlanganStage.pipelineId}:${ishlanganStage.statusId}` : undefined,
        ts: taklifStage ? `${taklifStage.pipelineId}:${taklifStage.statusId}` : undefined,
        refresh: input.refreshKey === undefined ? undefined : String(input.refreshKey),
      });
      const base = await getOrSet(cacheKey, 120, () => buildFunnelBase({
        tenantId: ctx.tenantId,
        rangeStart,
        rangeEnd,
        group: input.group,
        ishlanganStage,
        taklifStage,
      }));

      const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } });
      const plans = extractFunnelPlans(tenant?.settings);
      const rows = base.rows.map((row) => ({ ...row, plan: plans.get(row.userId) ?? 0 }));

      // Team ratios always use the whole selected group, even when the viewer only sees their own row.
      const groupTotals = sumFunnelRows(rows);
      const teamRatios = computeTeamRatios(groupTotals);
      const lostRows = rows.map((row) => computeLostRevenueRow(row, teamRatios));

      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);
      const visibleIds = scope.isScoped ? new Set([ctx.user.userId]) : null;
      let visibleRows = visibleIds ? rows.filter((row) => visibleIds.has(row.userId)) : rows;
      let visibleLostRows = visibleIds ? lostRows.filter((row) => visibleIds.has(row.userId)) : lostRows;

      if (isTashkiliyOnly(ctx.user.roles)) {
        visibleRows = visibleRows.map((row) => ({ ...row, agreementSum: 0, avgCheck: 0 }));
        visibleLostRows = visibleLostRows.map((row) => ({
          ...row, aktivlik: 0, taklif: 0, yopish: 0, chek: 0, mainHole: null, lostRevenue: 0,
        }));
      }

      return {
        range: input.range,
        dateFrom: rangeStart.toISOString(),
        dateTo: rangeEnd.toISOString(),
        group: input.group,
        stages: { ishlangan: ishlanganStage, taklif: taklifStage },
        sourceStatus: base.sourceStatus,
        unmappedManagerNames: visibleIds ? [] : base.unmappedManagerNames,
        rows: visibleRows,
        totals: sumFunnelRows(visibleRows),
        teamRatios,
        lostRevenue: { rows: visibleLostRows, totals: sumLostRevenueRows(visibleLostRows) },
        canEditPlans: ctx.user.roles.some((role) => PLAN_EDITOR_ROLES.includes(role)),
        updatedAt: now.toISOString(),
      };
    }),

  setPlan: protectedProcedure
    .input(z.object({ userId: z.string().min(1), plan: z.number().int().min(0).max(100_000) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.roles.some((role) => PLAN_EDITOR_ROLES.includes(role))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin or Manager access required' });
      }
      const [tenant, user] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } }),
        prisma.user.findFirst({ where: { id: input.userId, tenantId: ctx.tenantId, isActive: true }, select: { id: true } }),
      ]);

      if (!tenant) throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });

      const settings = asObject(tenant.settings) || {};
      const funnelSettings = asObject(settings.funnel) || {};
      const plans = { ...(asObject(funnelSettings.plans) || {}) };

      if (input.plan > 0) {
        plans[input.userId] = input.plan;
      } else {
        delete plans[input.userId];
      }
      const nextSettings = { ...settings, funnel: { ...funnelSettings, plans } };

      await prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: { settings: JSON.parse(JSON.stringify(nextSettings)) as Prisma.InputJsonValue },
      });
      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'funnel_plan_update',
          resource: 'tenant_settings',
          resourceId: input.userId,
        },
      });

      return { userId: input.userId, plan: input.plan };
    }),
});
