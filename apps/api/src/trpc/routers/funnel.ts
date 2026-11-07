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
  fetchPagesConcurrently,
  CALL_NOTE_TYPES,
  chunk,
  findAnsweredLeadIds,
  leadContactIds,
  MIN_ANSWERED_CALL_SECONDS,
  runWithConcurrency,
  type FunnelLeadLike,
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
import { getCallsProvider } from '../../services/calls-source';

const funnelGroupSchema = z.enum(['all', 'online', 'offline']);
const stageRefSchema = z.object({ pipelineId: z.string().min(1), statusId: z.string().min(1) });
const PLAN_EDITOR_ROLES = ['Admin', 'Manager'];
const LEADS_PAGE_SIZE = 250;
const LEADS_MAX_PAGES = 40;
const LEADS_CONCURRENCY = 4; // amoCRM allows ~7 requests/second per account
const LEADS_PAGE_TIMEOUT_MS = 20_000;
const NOTES_PAGE_SIZE = 250;
const NOTES_ENTITY_CHUNK = 100; // entity ids per notes request (keeps the URL short)
const NOTES_MAX_PAGES_PER_CHUNK = 20;

type FunnelSourceState = 'ok' | 'partial' | 'unavailable' | 'timeout';
type FunnelSourceEntry = { ok: boolean; reason: string | null; state: FunnelSourceState };
type FunnelSourceStatus = { leads: FunnelSourceEntry; calls: FunnelSourceEntry };

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
  pipelineId: string | null;
  taklifStage: FunnelStageRef | null;
}): Promise<FunnelBaseResult> {
  const { tenantId, rangeStart, rangeEnd } = params;
  const agents = await loadFunnelAgents(tenantId, params.group);
  const agentIds = agents.map((agent) => agent.id);
  const sourceStatus: FunnelSourceStatus = {
    leads: { ok: true, reason: null, state: 'ok' },
    calls: { ok: true, reason: null, state: 'ok' },
  };

  const extensionToUserId = new Map<string, string>();

  for (const agent of agents) {
    const extension = normalizeDigits(agent.utelManagerExternalId);

    if (isAllowedUtelManagerExtension(extension) && !extensionToUserId.has(extension)) {
      extensionToUserId.set(extension, agent.id);
    }
  }
  const extensions = Array.from(extensionToUserId.keys());
  const responsibleIds = Array.from(new Set(agents
    .map((agent) => (agent.amocrmResponsibleUserId ? String(agent.amocrmResponsibleUserId).trim() : ''))
    .filter(Boolean)));

  /** Lead ids with an answered call (>= 50 s) in amoCRM call notes on the lead or its contacts. */
  const loadAnsweredLeadIds = async (
    amoContext: NonNullable<Awaited<ReturnType<typeof getTenantAmoCRMContext>>>,
    leads: FunnelLeadLike[],
  ): Promise<Set<string> | null> => {
    const leadIds = Array.from(new Set(leads.map((lead) => String(lead.id ?? '')).filter(Boolean)));
    const contactIds = Array.from(new Set(leads.flatMap(leadContactIds)));

    if (!leadIds.length) return new Set();

    const fetchNotesFor = (entityType: 'leads' | 'contacts', entityIds: string[]) => async () => {
      const fetchPageOnce = (page: number) => withTimeout(
        amocrmService.fetchNotes(
          amoContext.accessToken,
          entityType,
          {
            page,
            limit: NOTES_PAGE_SIZE,
            noteTypes: CALL_NOTE_TYPES,
            entityIds,
            // A call note is created during the call; it can only be updated afterwards.
            updatedAtFrom: rangeStart,
          },
          amoContext.baseUrl,
        ),
        LEADS_PAGE_TIMEOUT_MS,
        'amo_notes_timeout',
      );
      const { items } = await fetchPagesConcurrently(
        async (page) => {
          try {
            return await fetchPageOnce(page);
          } catch {
            return fetchPageOnce(page);
          }
        },
        { pageSize: NOTES_PAGE_SIZE, maxPages: NOTES_MAX_PAGES_PER_CHUNK, concurrency: 1 },
      );

      return { entityType, items };
    };
    const tasks = [
      ...chunk(leadIds, NOTES_ENTITY_CHUNK).map((ids) => fetchNotesFor('leads', ids)),
      ...chunk(contactIds, NOTES_ENTITY_CHUNK).map((ids) => fetchNotesFor('contacts', ids)),
    ];

    try {
      const startedAt = Date.now();
      const results = await runWithConcurrency(tasks, LEADS_CONCURRENCY);
      const leadNotes = results.filter((result) => result.entityType === 'leads').flatMap((result) => result.items);
      const contactNotes = results.filter((result) => result.entityType === 'contacts').flatMap((result) => result.items);
      const answered = findAnsweredLeadIds(leads, leadNotes, contactNotes, { rangeEnd });

      log(LogLevel.INFO, 'Funnel: amoCRM call notes loaded', {
        tenantId,
        leads: leadIds.length,
        contacts: contactIds.length,
        notes: leadNotes.length + contactNotes.length,
        answeredLeads: answered.size,
        requests: tasks.length,
        ms: Date.now() - startedAt,
      });

      return answered;
    } catch (error) {
      const reason = detectLeadsFailureReason(error);

      sourceStatus.calls = { ok: false, reason: `calls_${reason}`, state: reason === 'timeout' ? 'timeout' : 'unavailable' };
      log(LogLevel.WARN, 'Funnel: amoCRM call notes unavailable', {
        tenantId,
        reason,
        error: String((error as Error | undefined)?.message || error),
      });

      return null;
    }
  };

  const loadLeads = async (): Promise<{ leads: FunnelLeadLike[]; answered: Set<string> | null } | null> => {
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
    if (!responsibleIds.length) {
      return { leads: [], answered: new Set() };
    }
    // Ask amoCRM only for what the table needs: the chosen funnel and the group's managers.
    const pipelineIds = params.pipelineId ? [params.pipelineId] : amoContext.selectedPipelineIds;
    const fetchPageOnce = async (page: number) => {
      const response = await withTimeout(
        amocrmService.fetchLeads(
          amoContext.accessToken,
          '',
          {
            page,
            limit: LEADS_PAGE_SIZE,
            with: 'contacts',
            pipelineIds: pipelineIds || undefined,
            responsibleUserIds: responsibleIds,
            createdAtFrom: rangeStart,
            createdAtTo: rangeEnd,
          },
          amoContext.baseUrl,
        ),
        LEADS_PAGE_TIMEOUT_MS,
        'amo_leads_timeout',
      );

      return (response._embedded?.leads ?? []) as FunnelLeadLike[];
    };
    const fetchPage = async (page: number) => {
      try {
        return await fetchPageOnce(page);
      } catch {
        return fetchPageOnce(page);
      }
    };

    try {
      const startedAt = Date.now();
      const { items, truncated } = await fetchPagesConcurrently(fetchPage, {
        pageSize: LEADS_PAGE_SIZE,
        maxPages: LEADS_MAX_PAGES,
        concurrency: LEADS_CONCURRENCY,
      });

      if (truncated) {
        sourceStatus.leads = { ok: false, reason: 'page_cap', state: 'partial' };
      }
      log(LogLevel.INFO, 'Funnel: amoCRM leads loaded', {
        tenantId,
        leads: items.length,
        pipelines: pipelineIds?.length ?? 0,
        managers: responsibleIds.length,
        ms: Date.now() - startedAt,
      });

      return { leads: items, answered: await loadAnsweredLeadIds(amoContext, items) };
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

  const [leadsResult, pipelinesResult, calls, salesRaw] = await Promise.all([
    loadLeads(),
    params.taklifStage
      ? loadFunnelPipelines(tenantId).catch(() => ({ connected: false, pipelines: [] as FunnelPipeline[] }))
      : Promise.resolve({ connected: true, pipelines: [] as FunnelPipeline[] }),
    extensions.length
      ? prisma.call.findMany({
          where: {
            tenantId,
            provider: await getCallsProvider(tenantId),
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
  const leads = leadsResult?.leads ?? null;
  const answeredLeadIds = leadsResult?.answered ?? null;
  const leadBuckets = leads
    ? bucketLeadsByResponsible(leads, params.taklifStage, stageIndex, answeredLeadIds ?? new Set())
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
      ishlanganLeads: leadsKnown && answeredLeadIds ? (bucket?.ishlangan ?? 0) : null,
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
        pipelineId: z.string().min(1).nullable().optional(),
        taklifStage: stageRefSchema.nullable().optional(),
        refreshKey: z.number().int().nonnegative().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const taklifStage = input.taklifStage ?? null;

      const cacheKey = buildCacheKey('funnel', {
        t: ctx.tenantId,
        r: input.range,
        df: input.dateFrom,
        dt: input.dateTo,
        g: input.group,
        p: input.pipelineId ?? undefined,
        v: 'calls50', // Ishlangan = answered call >= 50 s (bump when the definition changes)
        ts: taklifStage ? `${taklifStage.pipelineId}:${taklifStage.statusId}` : undefined,
        refresh: input.refreshKey === undefined ? undefined : String(input.refreshKey),
      });
      const base = await getOrSet(cacheKey, 120, () => buildFunnelBase({
        tenantId: ctx.tenantId,
        rangeStart,
        rangeEnd,
        group: input.group,
        pipelineId: input.pipelineId ?? null,
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
        stages: { taklif: taklifStage },
        minAnsweredCallSeconds: MIN_ANSWERED_CALL_SECONDS,
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
