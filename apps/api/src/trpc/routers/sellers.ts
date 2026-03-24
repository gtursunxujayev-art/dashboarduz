import { router, protectedProcedure } from '../trpc';
import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { amocrmService, type AmoCRMLead, type AmoCRMLeadPipeline, type AmoCRMUser } from '../../services/integrations/amocrm';
import {
  getAmoCRMActivityMetrics,
  type AmoCRMActivityMetrics,
  summarizeAmoCRMActivityMetrics,
} from '../../services/integrations/amocrm-activity';
import { getTenantAmoCRMContext } from '../../services/integrations/amocrm-live';
import { log, LogLevel } from '../../services/observability';

const WON_STATUS_ID = '142';
const LOST_STATUS_ID = '143';
const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'Finance']);
const sellerRangeSchema = z.enum(['today', 'week', 'month', 'custom']);
type SellerRange = z.infer<typeof sellerRangeSchema>;
const REPORT_TZ_OFFSET_MINUTES = 5 * 60; // GMT+5
const SELLERS_LIST_CACHE_TTL_MS = 2 * 60 * 1000;
const SELLERS_ACTIVITY_CACHE_TTL_MS = 10 * 60 * 1000;

type SellersListCacheEntry = {
  expiresAt: number;
  data: any[];
};

const sellersListCache = new Map<string, SellersListCacheEntry>();

function asString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function parseAmoDate(value: unknown): Date {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(millis);
  }

  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber)) {
      return parseAmoDate(asNumber);
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date(0);
}

function getRangeStart(range: SellerRange, now: Date): Date {
  const offsetMs = REPORT_TZ_OFFSET_MINUTES * 60 * 1000;
  const shiftedNow = new Date(now.getTime() + offsetMs);

  const year = shiftedNow.getUTCFullYear();
  const month = shiftedNow.getUTCMonth();
  const date = shiftedNow.getUTCDate();

  if (range === 'today') {
    return new Date(Date.UTC(year, month, date) - offsetMs);
  }

  if (range === 'week') {
    const day = shiftedNow.getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    return new Date(Date.UTC(year, month, date - daysSinceMonday) - offsetMs);
  }

  return new Date(Date.UTC(year, month, 1) - offsetMs);
}

function parseCustomDate(input: string, endOfDay: boolean): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Custom date must be in YYYY-MM-DD format.' });
  }

  const timestamp = `${input}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}+05:00`;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid custom date: ${input}` });
  }

  return parsed;
}

function resolveDateRange(range: SellerRange, now: Date, dateFrom?: string, dateTo?: string) {
  if (range !== 'custom') {
    return {
      rangeStart: getRangeStart(range, now),
      rangeEnd: now,
    };
  }

  if (!dateFrom || !dateTo) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Both dateFrom and dateTo are required when range is custom.',
    });
  }

  const rangeStart = parseCustomDate(dateFrom, false);
  const rangeEnd = parseCustomDate(dateTo, true);
  if (rangeEnd < rangeStart) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'dateTo must be greater than or equal to dateFrom.' });
  }

  return { rangeStart, rangeEnd };
}

function getDealAmount(lead: AmoCRMLead): number {
  const maybePrice = (lead as Record<string, unknown>).price;
  if (typeof maybePrice === 'number' && Number.isFinite(maybePrice)) {
    return maybePrice;
  }
  if (typeof maybePrice === 'string') {
    const parsed = Number(maybePrice);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function getLeadResponsibleId(lead: AmoCRMLead): string | null {
  return asString(lead.responsible_user_id);
}

function normalizeDigits(value: unknown): string {
  return String(value || '').replace(/[^\d]/g, '');
}

function isAllowedUtelManagerExtension(value: unknown): boolean {
  const digits = normalizeDigits(value);
  if (!digits) {
    return false;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 150;
}

function isMissingUserMappingColumnError(error: unknown) {
  const message = String((error as any)?.message || '');
  return message.includes('amocrmResponsibleUserId') || message.includes('utelManagerExternalId');
}

function toManagerRole(user: AmoCRMUser): string[] {
  return user.rights?.is_admin ? ['Manager'] : ['Agent'];
}

async function getAgentResponsibleScope(tenantId: string, userId: string, roles: string[]) {
  const isAgentOnly = roles.includes('Agent') && !roles.some((role) => PRIVILEGED_ROLES.has(role));
  if (!isAgentOnly) {
    return { isScoped: false, responsibleUserId: null as string | null };
  }

  let currentUser: { amocrmResponsibleUserId: string | null } | null = null;
  try {
    currentUser = await prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        isActive: true,
      },
      select: {
        amocrmResponsibleUserId: true,
      },
    });
  } catch (error: any) {
    if (!String(error?.message || '').includes('amocrmResponsibleUserId')) {
      throw error;
    }
  }

  return {
    isScoped: true,
    responsibleUserId: currentUser?.amocrmResponsibleUserId || null,
  };
}

function buildMetrics(
  activeLeads: AmoCRMLead[],
  wonLeadsData: AmoCRMLead[],
  lostLeadsData: AmoCRMLead[],
  calls: Array<{ duration: number | null; direction: string; status: string; startedAt?: Date | null }>,
  options?: {
    incomeAmountOverride?: number | null;
    neutralizeLeadOutcomes?: boolean;
    activityMetrics?: AmoCRMActivityMetrics | null;
  },
) {
  const activeLeadsCount = activeLeads.length;
  const neutralizeLeadOutcomes = Boolean(options?.neutralizeLeadOutcomes);
  const wonLeads = neutralizeLeadOutcomes ? 0 : wonLeadsData.length;
  const lostLeads = neutralizeLeadOutcomes ? 0 : lostLeadsData.length;
  const totalLeads = neutralizeLeadOutcomes ? activeLeadsCount : (activeLeadsCount + wonLeads + lostLeads);
  const conversionRate = neutralizeLeadOutcomes ? 0 : (totalLeads > 0 ? (wonLeads / totalLeads) * 100 : 0);

  const totalDealAmount = neutralizeLeadOutcomes
    ? 0
    : wonLeadsData.reduce((sum, lead) => sum + getDealAmount(lead), 0);
  const averageDealAmount = neutralizeLeadOutcomes ? 0 : (wonLeads > 0 ? totalDealAmount / wonLeads : 0);

  const totalCalls = calls.length;
  const inboundCalls = calls.filter((call) => call.direction === 'inbound').length;
  const outboundCalls = calls.filter((call) => call.direction === 'outbound').length;
  const totalCallDuration = calls.reduce((sum, call) => sum + (call.duration || 0), 0);
  const averageCallDuration = totalCalls > 0 ? totalCallDuration / totalCalls : 0;
  const activeCallDays = new Set(
    calls
      .map((call) => (call.startedAt instanceof Date ? call.startedAt : null))
      .filter((value): value is Date => Boolean(value))
      .map((value) => value.toISOString().slice(0, 10)),
  ).size;
  const averageDailyCalls = activeCallDays > 0 ? totalCalls / activeCallDays : 0;
  const averageDailyCallDuration = activeCallDays > 0 ? totalCallDuration / activeCallDays : 0;
  const incomeAmount = typeof options?.incomeAmountOverride === 'number' ? options.incomeAmountOverride : totalDealAmount;
  const activityMetrics = options?.activityMetrics || {
    followUpCount: 0,
    noteCount: 0,
    stageChangeCount: 0,
    overdueFollowUpCount: 0,
    todayFollowUpCount: 0,
  };

  return {
    newLeads: neutralizeLeadOutcomes ? activeLeadsCount : totalLeads,
    qualifiedLeads: neutralizeLeadOutcomes ? 0 : wonLeads,
    unqualifiedLeads: neutralizeLeadOutcomes ? 0 : lostLeads,
    salesCount: neutralizeLeadOutcomes ? 0 : wonLeads,
    totalLeads,
    activeLeads: activeLeadsCount,
    wonLeads,
    lostLeads,
    conversionRate: Number(conversionRate.toFixed(2)),
    totalDealAmount: Number(totalDealAmount.toFixed(2)),
    averageDealAmount: Number(averageDealAmount.toFixed(2)),
    totalCalls,
    inboundCalls,
    outboundCalls,
    totalCallDuration,
    averageCallDuration: Number(averageCallDuration.toFixed(2)),
    averageDailyCalls: Number(averageDailyCalls.toFixed(2)),
    averageDailyCallDuration: Number(averageDailyCallDuration.toFixed(2)),
    incomeAmount: Number(incomeAmount.toFixed(2)),
    followUpCount: activityMetrics.followUpCount,
    noteCount: activityMetrics.noteCount,
    stageChangeCount: activityMetrics.stageChangeCount,
    overdueFollowUpCount: activityMetrics.overdueFollowUpCount,
    todayFollowUpCount: activityMetrics.todayFollowUpCount,
  };
}

function getSelectedPipelines(
  selectedPipelineIds: string[] | null,
  pipelines: AmoCRMLeadPipeline[],
): string[] {
  if (selectedPipelineIds !== null) {
    return selectedPipelineIds.map((id) => String(id).trim()).filter(Boolean);
  }

  return pipelines
    .map((pipeline) => asString(pipeline.id))
    .filter(Boolean) as string[];
}

function buildStatusFilters(
  selectedPipelineIds: string[],
  pipelines: AmoCRMLeadPipeline[],
  statusIds: string[],
): Array<{ pipelineId: string; statusId: string }> {
  if (selectedPipelineIds.length === 0 || statusIds.length === 0) {
    return [];
  }

  const selected = new Set(selectedPipelineIds);
  const unique = new Set<string>();
  const filters: Array<{ pipelineId: string; statusId: string }> = [];

  for (const pipeline of pipelines) {
    const pipelineId = asString(pipeline.id);
    if (!pipelineId || !selected.has(pipelineId)) {
      continue;
    }

    const statuses = Array.isArray(pipeline._embedded?.statuses) ? pipeline._embedded.statuses : [];
    const availableStatusIds = new Set(
      statuses
        .map((status) => asString(status.id))
        .filter(Boolean) as string[],
    );

    for (const statusId of statusIds) {
      if (!availableStatusIds.has(statusId)) {
        continue;
      }

      const key = `${pipelineId}:${statusId}`;
      if (unique.has(key)) {
        continue;
      }
      unique.add(key);
      filters.push({ pipelineId, statusId });
    }
  }

  return filters;
}

function buildStatusFilterSet(filters: Array<{ pipelineId: string; statusId: string }>): Set<string> {
  return new Set(filters.map((filter) => `${filter.pipelineId}:${filter.statusId}`));
}

function isLeadInStatusSet(lead: AmoCRMLead, statusSet: Set<string>) {
  const pipelineId = asString(lead.pipeline_id);
  const statusId = asString(lead.status_id);
  if (!pipelineId || !statusId) {
    return false;
  }
  return statusSet.has(`${pipelineId}:${statusId}`);
}

async function fetchLeadsByStatusFilters(
  accessToken: string,
  baseUrl: string | undefined,
  pipelineIds: string[],
  statusFilters: Array<{ pipelineId: string; statusId: string }>,
  responsibleUserIds: string[],
  rangeStart?: Date,
  rangeEnd?: Date,
  withContacts = false,
): Promise<AmoCRMLead[]> {
  if (pipelineIds.length === 0 || statusFilters.length === 0 || responsibleUserIds.length === 0) {
    return [];
  }

  const statusSet = buildStatusFilterSet(statusFilters);
  try {
    return await amocrmService.fetchAllLeads(
      accessToken,
      {
        pipelineIds,
        statusFilters,
        responsibleUserIds,
        createdAtFrom: rangeStart,
        createdAtTo: rangeEnd,
        with: withContacts ? 'contacts' : undefined,
        limit: 250,
      },
      baseUrl,
    );
  } catch {
    const fallback = await amocrmService.fetchAllLeads(
      accessToken,
      {
        pipelineIds,
        responsibleUserIds,
        createdAtFrom: rangeStart,
        createdAtTo: rangeEnd,
        with: withContacts ? 'contacts' : undefined,
        limit: 250,
      },
      baseUrl,
    );
    return fallback.filter((lead) => {
      if (!isLeadInStatusSet(lead, statusSet)) {
        return false;
      }
      if (!rangeStart || !rangeEnd) {
        return true;
      }
      const createdAt = parseAmoDate(lead.created_at);
      return createdAt >= rangeStart && createdAt <= rangeEnd;
    });
  }
}

async function getManagerExtensionsMap(tenantId: string, managerIds: string[]): Promise<Map<string, string[]>> {
  if (managerIds.length === 0) {
    return new Map();
  }

  try {
    const mappedUsers = await prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        amocrmResponsibleUserId: { in: managerIds },
        utelManagerExternalId: { not: null },
      },
      select: {
        amocrmResponsibleUserId: true,
        utelManagerExternalId: true,
      },
    });

    const byManager = new Map<string, Set<string>>();
    for (const mappedUser of mappedUsers as Array<{ amocrmResponsibleUserId: string | null; utelManagerExternalId: string | null }>) {
      const managerId = asString(mappedUser.amocrmResponsibleUserId);
      const extension = normalizeDigits(mappedUser.utelManagerExternalId || '');
      if (!managerId || !isAllowedUtelManagerExtension(extension)) {
        continue;
      }
      const current = byManager.get(managerId) || new Set<string>();
      current.add(extension);
      byManager.set(managerId, current);
    }

    return new Map(
      Array.from(byManager.entries()).map(([managerId, extensions]) => [managerId, Array.from(extensions)]),
    );
  } catch (error) {
    if (!isMissingUserMappingColumnError(error)) {
      throw error;
    }
    return new Map();
  }
}

function resolveCallExtension(call: { from: string; to: string }): string | null {
  const fromExtension = normalizeDigits(call.from);
  if (isAllowedUtelManagerExtension(fromExtension)) {
    return fromExtension;
  }
  const toExtension = normalizeDigits(call.to);
  if (isAllowedUtelManagerExtension(toExtension)) {
    return toExtension;
  }
  return null;
}

function buildSellersListCacheKey(
  tenantId: string,
  scopedResponsibleUserId: string | null,
  pipelineIds: string[],
): string {
  return [
    tenantId,
    scopedResponsibleUserId || 'all',
    pipelineIds.slice().sort().join(','),
  ].join('|');
}

export const sellersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const startedAtMs = Date.now();
    const timings: Record<string, number> = {};
    const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);
    timings.scopeMs = Date.now() - startedAtMs;

    const amoContextStartedMs = Date.now();
    const amoContext = await getTenantAmoCRMContext(ctx.tenantId);
    timings.amoContextMs = Date.now() - amoContextStartedMs;

    if (!amoContext) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'AmoCRM integration is not connected.',
      });
    }

    const amocrmUsersPromise = (async () => {
      const stepStartedMs = Date.now();
      const result = await amocrmService.fetchAllUsers(amoContext.accessToken, { limit: 250 }, amoContext.baseUrl);
      timings.amocrmUsersMs = Date.now() - stepStartedMs;
      return result;
    })();

    const pipelinesPromise = (async () => {
      const stepStartedMs = Date.now();
      const result = await amocrmService.fetchPipelines(amoContext.accessToken, amoContext.baseUrl);
      timings.amocrmPipelinesMs = Date.now() - stepStartedMs;
      return result;
    })();

    const [amocrmUsers, pipelinesResponse] = await Promise.all([amocrmUsersPromise, pipelinesPromise]);
    const pipelines = Array.isArray(pipelinesResponse._embedded?.pipelines) ? pipelinesResponse._embedded.pipelines : [];
    const selectedPipelineIds = getSelectedPipelines(amoContext.selectedPipelineIds, pipelines);

    const managerPreparationStartedMs = Date.now();
    const managers = amocrmUsers
      .filter((user) => user.is_active !== false)
      .filter((user) => {
        if (!scope.isScoped) {
          return true;
        }
        return asString(user.id) === scope.responsibleUserId;
      });

    const managerIds = new Set(
      managers
        .map((manager) => asString(manager.id))
        .filter(Boolean) as string[],
    );
    timings.managerPreparationMs = Date.now() - managerPreparationStartedMs;

    const managerIdList = Array.from(managerIds);
    const listCacheKey = buildSellersListCacheKey(
      ctx.tenantId,
      scope.isScoped ? (scope.responsibleUserId || '__unmapped__') : null,
      selectedPipelineIds,
    );
    const cached = sellersListCache.get(listCacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      timings.totalMs = Date.now() - startedAtMs;
      log(LogLevel.INFO, 'Sellers list timings', {
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        managerCount: managers.length,
        selectedPipelineIds,
        cacheHit: true,
        timings,
      });
      return cached.data;
    }

    const leadsFetchStartedMs = Date.now();
    const activeLeadsPromise = (async () => {
      const allPipelineLeads = await amocrmService.fetchAllLeads(
        amoContext.accessToken,
        {
          pipelineIds: selectedPipelineIds,
          responsibleUserIds: managerIdList,
          limit: 250,
          maxPages: 300,
        },
        amoContext.baseUrl,
      );
      return allPipelineLeads.filter((lead) => {
        const statusId = asString(lead.status_id);
        return statusId !== WON_STATUS_ID && statusId !== LOST_STATUS_ID;
      });
    })();

    const activityFetchStartedMs = Date.now();
    const roundedNow = new Date(Math.floor(Date.now() / (5 * 60 * 1000)) * (5 * 60 * 1000));
    const activityPromise = getAmoCRMActivityMetrics({
      tenantId: ctx.tenantId,
      accessToken: amoContext.accessToken,
      baseUrl: amoContext.baseUrl,
      managerIds: managerIdList,
      rangeStart: new Date(0),
      rangeEnd: roundedNow,
      rangeKind: 'today',
      cacheTtlMs: SELLERS_ACTIVITY_CACHE_TTL_MS,
    });

    const extensionMappingStartedMs = Date.now();
    const extensionsByManagerPromise = getManagerExtensionsMap(ctx.tenantId, managerIdList);

    const [activeLeads, activityByManager, extensionsByManager] = await Promise.all([
      activeLeadsPromise,
      activityPromise,
      extensionsByManagerPromise,
    ]);
    timings.amocrmLeadsMs = Date.now() - leadsFetchStartedMs;
    timings.activityFetchMs = Date.now() - activityFetchStartedMs;
    timings.extensionMappingMs = Date.now() - extensionMappingStartedMs;

    const leadsGroupingStartedMs = Date.now();
    const activeLeadsByManager = new Map<string, AmoCRMLead[]>();
    for (const lead of activeLeads) {
      const responsibleUserId = getLeadResponsibleId(lead);
      if (!responsibleUserId || !managerIds.has(responsibleUserId)) {
        continue;
      }
      const current = activeLeadsByManager.get(responsibleUserId) || [];
      current.push(lead);
      activeLeadsByManager.set(responsibleUserId, current);
    }
    timings.leadsGroupingMs = Date.now() - leadsGroupingStartedMs;

    const managerByExtension = new Map<string, string>();
    for (const [managerId, extensions] of extensionsByManager.entries()) {
      for (const extension of extensions) {
        managerByExtension.set(extension, managerId);
      }
    }

    const callsFetchStartedMs = Date.now();
    const extensionValues = Array.from(new Set(Array.from(extensionsByManager.values()).flat()));
    const calls = extensionValues.length > 0
      ? await prisma.call.findMany({
          where: {
            tenantId: ctx.tenantId,
            provider: 'utel',
            OR: [
              { from: { in: extensionValues } },
              { to: { in: extensionValues } },
            ],
          },
          select: {
            from: true,
            to: true,
            duration: true,
            direction: true,
            status: true,
            startedAt: true,
          },
        })
      : [];
    timings.callsFetchMs = Date.now() - callsFetchStartedMs;

    const callsGroupingStartedMs = Date.now();
    const callsByManager = new Map<string, Array<{ duration: number | null; direction: string; status: string; startedAt: Date | null }>>();
    for (const call of calls) {
      const extension = resolveCallExtension({
        from: call.from,
        to: call.to,
      });
      if (!extension) {
        continue;
      }

      const managerId = managerByExtension.get(extension);
      if (!managerId) {
        continue;
      }

      const current = callsByManager.get(managerId) || [];
      current.push({
        duration: call.duration,
        direction: call.direction,
        status: call.status,
        startedAt: call.startedAt,
      });
      callsByManager.set(managerId, current);
    }
    timings.callsGroupingMs = Date.now() - callsGroupingStartedMs;

    const buildResponseStartedMs = Date.now();
    const result = managers
      .map((manager) => {
        const managerId = asString(manager.id) || '';
        const managerActiveLeads = activeLeadsByManager.get(managerId) || [];
        const managerCalls = callsByManager.get(managerId) || [];
        const managerActivity = activityByManager.get(managerId) || null;

        return {
          id: managerId,
          name: manager.name || manager.login || `Manager ${managerId}`,
          email: manager.email || null,
          phone: null,
          roles: toManagerRole(manager),
          lastLoginAt: null,
          createdAt: new Date(0),
          metrics: buildMetrics(managerActiveLeads, [], [], managerCalls, {
            neutralizeLeadOutcomes: true,
            activityMetrics: managerActivity,
          }),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    timings.buildResponseMs = Date.now() - buildResponseStartedMs;
    timings.totalMs = Date.now() - startedAtMs;

    log(LogLevel.INFO, 'Sellers list timings', {
      tenantId: ctx.tenantId,
      userId: ctx.user.userId,
      managerCount: managers.length,
      selectedPipelineIds,
      activeLeadsCount: activeLeads.length,
      callsCount: calls.length,
      activityTotals: summarizeAmoCRMActivityMetrics(activityByManager),
      cacheHit: false,
      timings,
    });

    sellersListCache.set(listCacheKey, {
      expiresAt: Date.now() + SELLERS_LIST_CACHE_TTL_MS,
      data: result,
    });

    return result;
  }),

  getById: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        range: sellerRangeSchema.default('today'),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);
      if (scope.isScoped && input.id !== scope.responsibleUserId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Seller not found' });
      }

      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);

      const amoContext = await getTenantAmoCRMContext(ctx.tenantId);
      if (!amoContext) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'AmoCRM integration is not connected.',
        });
      }

      const [amocrmUsers, pipelinesResponse] = await Promise.all([
        amocrmService.fetchAllUsers(amoContext.accessToken, { limit: 250 }, amoContext.baseUrl),
        amocrmService.fetchPipelines(amoContext.accessToken, amoContext.baseUrl),
      ]);
      const pipelines = Array.isArray(pipelinesResponse._embedded?.pipelines) ? pipelinesResponse._embedded.pipelines : [];
      const selectedPipelineIds = getSelectedPipelines(amoContext.selectedPipelineIds, pipelines);

      const activeStatusFilters = buildStatusFilters(
        selectedPipelineIds,
        pipelines,
        pipelines
          .flatMap((pipeline) => (Array.isArray(pipeline._embedded?.statuses) ? pipeline._embedded.statuses : []))
          .map((status) => asString(status.id))
          .filter((statusId): statusId is string => Boolean(statusId) && statusId !== WON_STATUS_ID && statusId !== LOST_STATUS_ID),
      );
      const wonStatusFilters = buildStatusFilters(selectedPipelineIds, pipelines, [WON_STATUS_ID]);
      const lostStatusFilters = buildStatusFilters(selectedPipelineIds, pipelines, [LOST_STATUS_ID]);

      const [activeLeads, wonLeads, lostLeads] = await Promise.all([
        fetchLeadsByStatusFilters(
          amoContext.accessToken,
          amoContext.baseUrl,
          selectedPipelineIds,
          activeStatusFilters,
          [input.id],
          rangeStart,
          rangeEnd,
          true,
        ),
        fetchLeadsByStatusFilters(
          amoContext.accessToken,
          amoContext.baseUrl,
          selectedPipelineIds,
          wonStatusFilters,
          [input.id],
          rangeStart,
          rangeEnd,
        ),
        fetchLeadsByStatusFilters(
          amoContext.accessToken,
          amoContext.baseUrl,
          selectedPipelineIds,
          lostStatusFilters,
          [input.id],
          rangeStart,
          rangeEnd,
        ),
      ]);

      const sellerUser = amocrmUsers.find((user) => asString(user.id) === input.id);
      if (!sellerUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Seller not found' });
      }

      const extensionsByManager = await getManagerExtensionsMap(ctx.tenantId, [input.id]);
      const extensions = extensionsByManager.get(input.id) || [];

      const callsForMetrics = extensions.length > 0
        ? await prisma.call.findMany({
            where: {
              tenantId: ctx.tenantId,
              provider: 'utel',
              startedAt: {
                gte: rangeStart,
                lte: rangeEnd,
              },
              OR: [
                { from: { in: extensions } },
                { to: { in: extensions } },
              ],
            },
            select: {
              duration: true,
              status: true,
              direction: true,
              startedAt: true,
            },
          })
      : [];

      const recentCalls = extensions.length > 0
        ? await prisma.call.findMany({
            where: {
              tenantId: ctx.tenantId,
              provider: 'utel',
              startedAt: {
                gte: rangeStart,
                lte: rangeEnd,
              },
              OR: [
                { from: { in: extensions } },
                { to: { in: extensions } },
              ],
            },
            select: {
              id: true,
              from: true,
              to: true,
              duration: true,
              status: true,
              direction: true,
              startedAt: true,
            },
            orderBy: {
              startedAt: 'desc',
            },
            take: 50,
          })
        : [];

      let mappedManagerUserIds: string[] = [];
      try {
        mappedManagerUserIds = (
          await prisma.user.findMany({
            where: {
              tenantId: ctx.tenantId,
              isActive: true,
              amocrmResponsibleUserId: input.id,
            },
            select: { id: true },
          })
        ).map((user) => user.id);
      } catch (error) {
        if (!isMissingUserMappingColumnError(error)) {
          throw error;
        }
      }

      const incomeAggregate = mappedManagerUserIds.length > 0
        ? await prisma.income.aggregate({
            where: {
              tenantId: ctx.tenantId,
              lifecycleStatus: 'active',
              managerUserId: { in: mappedManagerUserIds },
              entryDate: {
                gte: rangeStart,
                lte: rangeEnd,
              },
            },
            _sum: {
              paymentAmount: true,
            },
          })
        : null;
      const incomeAmount = incomeAggregate?._sum?.paymentAmount ?? null;
      const activityMetrics = (
        await getAmoCRMActivityMetrics({
          tenantId: ctx.tenantId,
          accessToken: amoContext.accessToken,
          baseUrl: amoContext.baseUrl,
          managerIds: [input.id],
          rangeStart,
          rangeEnd,
          rangeKind: input.range,
        })
      ).get(input.id) || null;

      const metrics = buildMetrics(
        activeLeads,
        wonLeads,
        lostLeads,
        (callsForMetrics as Array<{ duration: number | null; direction: string; status: string; startedAt: Date | null }>).map((call) => ({
          duration: call.duration,
          direction: call.direction,
          status: call.status,
          startedAt: call.startedAt,
        })),
        {
          incomeAmountOverride: incomeAmount,
          activityMetrics,
        },
      );

      const recentLeads = activeLeads
        .slice()
        .sort((a, b) => parseAmoDate(b.created_at).getTime() - parseAmoDate(a.created_at).getTime())
        .slice(0, 50)
        .map((lead) => {
          const firstContact = Array.isArray(lead._embedded?.contacts) ? lead._embedded?.contacts[0] : null;
          const contact = firstContact && typeof firstContact === 'object'
            ? {
                name: asString((firstContact as Record<string, unknown>).name),
                phone: null,
                email: null,
              }
            : null;

          return {
            id: asString(lead.id) || '',
            title: lead.name || 'Untitled lead',
            status: asString(lead.status_id),
            metadata: lead,
            createdAt: parseAmoDate(lead.created_at),
            updatedAt: parseAmoDate(lead.updated_at),
            contact,
          };
        });

      return {
        seller: {
          id: input.id,
          name: sellerUser.name || sellerUser.login || `Manager ${input.id}`,
          email: sellerUser.email || null,
          phone: null,
          roles: toManagerRole(sellerUser),
          lastLoginAt: null,
          createdAt: new Date(0),
        },
        metrics,
        recentLeads,
        recentCalls,
        period: {
          range: input.range,
          dateFrom: input.range === 'custom' ? input.dateFrom || null : null,
          dateTo: input.range === 'custom' ? input.dateTo || null : null,
          rangeStart,
          rangeEnd,
        },
      };
    }),
});
