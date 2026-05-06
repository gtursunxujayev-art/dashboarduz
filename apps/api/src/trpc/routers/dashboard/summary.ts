import {
  prisma,
  TRPCError,
  z,
  asObject,
  asStringArray,
  extractLeadValue,
  getSystemLeadFieldOptions,
  getTenantAmoCRMContext,
  humanizeKey,
  amocrmService,
  getAmoCRMActivityMetrics,
  summarizeAmoCRMActivityMetrics,
  LogLevel,
  log,
  protectedProcedure,
  dashboardRangeSchema,
  INCOME_LIFECYCLE_ACTIVE,
  INCOME_LIFECYCLE_REFUNDED,
  REPORT_MONTH_LABELS_UZ,
  REPORT_TZ_OFFSET_MS,
  isMissingUserMappingColumnError,
  normalizeTextToken,
  normalizeDigits,
  isAllowedUtelManagerExtension,
  extractUtelManagerKey,
  resolveCallExtension,
  getAgentResponsibleScope,
  resolveDateRange,
  isTashkiliyOnly,
  classifyCourseCategoryFromField,
  isMappedValue,
  toPieData,
  buildFieldLabelMap,
  collectCatalogFieldOptions,
  shiftToReportTimezone,
  fromReportLocalParts,
  getDaysInReportLocalMonth,
  getReportLocalDayOfYear,
  getReportLocalDaysInYear,
  getReportLocalDayOfYearForMonthEnd,
  buildTrend,
} from './helpers';
import { getOrSet, buildCacheKey } from '../../../services/cache';
import { buildSaleChainMetricsBySaleId } from '../../../services/income-chain';
import { getCorporateCallDurationByManager } from '../../../services/corporate-call-durations';

type SummarySourceStatusKey = 'amoContext' | 'catalog' | 'leads' | 'activity' | 'corporateCalls';
type SummarySourceStatusEntry = {
  ok: boolean;
  retried: boolean;
  reason: string | null;
};
type SummarySourceStatus = Record<SummarySourceStatusKey, SummarySourceStatusEntry>;

function createSummarySourceStatus(): SummarySourceStatus {
  return {
    amoContext: { ok: true, retried: false, reason: null },
    catalog: { ok: true, retried: false, reason: null },
    leads: { ok: true, retried: false, reason: null },
    activity: { ok: true, retried: false, reason: null },
    corporateCalls: { ok: true, retried: false, reason: null },
  };
}

function detectSummarySourceReason(error: unknown, fallback: string): string {
  const message = String((error as Error | undefined)?.message || '');
  if (message.includes('Failed to decrypt integration tokens')) {
    return 'decrypt_failed';
  }
  if (message.toLowerCase().includes('timeout')) {
    return 'timeout';
  }
  if (message.toLowerCase().includes('network') || message.toLowerCase().includes('fetch')) {
    return 'network_error';
  }
  return fallback;
}

async function runSummarySourceWithRetry<T>(params: {
  key: SummarySourceStatusKey;
  status: SummarySourceStatus;
  logContext: { tenantId: string; userId: string };
  reasonFallback: string;
  fallback: T;
  run: () => Promise<T>;
}): Promise<T> {
  const { key, status, logContext, reasonFallback, fallback, run } = params;
  try {
    return await run();
  } catch (firstError) {
    status[key].retried = true;
    try {
      return await run();
    } catch (secondError) {
      const reason = detectSummarySourceReason(secondError || firstError, reasonFallback);
      status[key].ok = false;
      status[key].reason = reason;
      log(LogLevel.WARN, `Dashboard summary source degraded: ${key}`, {
        ...logContext,
        reason,
        error: String((secondError as Error | undefined)?.message || (firstError as Error | undefined)?.message || secondError || firstError),
      });
      return fallback;
    }
  }
}

export const summaryProcedures = {
  summary: protectedProcedure
    .input(
      z.object({
        range: dashboardRangeSchema,
        pipelineIds: z.array(z.string()).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const corporateRevision = await prisma.corporateCallDuration.aggregate({
        where: { tenantId: ctx.tenantId },
        _max: { updatedAt: true },
      });
      const corporateRevisionKey = corporateRevision._max.updatedAt
        ? corporateRevision._max.updatedAt.toISOString()
        : '';
      const cacheKey = buildCacheKey('summary', {
        t: ctx.tenantId,
        u: ctx.user.userId,
        r: input.range,
        p: input.pipelineIds,
        df: input.dateFrom,
        dt: input.dateTo,
        cr: corporateRevisionKey,
      });
      return getOrSet(cacheKey, 120, async () => {
      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const tashkiliyOnly = isTashkiliyOnly(ctx.user.roles);
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);
      const tenant = await prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { settings: true },
      });

      if (!tenant) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
      }

      const settings = asObject(tenant.settings);
      const dashboardSettings = asObject(settings?.dashboard);
      const reasonFieldKey = typeof dashboardSettings?.reasonFieldKey === 'string' ? dashboardSettings.reasonFieldKey : null;
      const sourceFieldKey = typeof dashboardSettings?.sourceFieldKey === 'string' ? dashboardSettings.sourceFieldKey : null;
      const qualifiedValues = asStringArray(dashboardSettings?.qualifiedValues);
      const nonQualifiedValues = asStringArray(dashboardSettings?.nonQualifiedValues);
      const qualifiedStageIds = asStringArray(dashboardSettings?.qualifiedStageIds);

      // Tahlil source map:
      // - dashboard.summary (this route) => KPI/team block
      // - analyticsAi.metaInsights => Meta block
      // - analyticsAi.generateSuggestions => AI block
      const sourceStatus = createSummarySourceStatus();
      const sourceLogContext = {
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
      };

      const amoContext = await runSummarySourceWithRetry({
        key: 'amoContext',
        status: sourceStatus,
        logContext: sourceLogContext,
        reasonFallback: 'amo_context_failed',
        fallback: null as Awaited<ReturnType<typeof getTenantAmoCRMContext>>,
        run: async () => getTenantAmoCRMContext(ctx.tenantId),
      });
      if (!amoContext) {
        sourceStatus.amoContext.ok = false;
        sourceStatus.amoContext.reason = sourceStatus.amoContext.reason || 'amo_not_connected';
      }

      const catalogOptions = amoContext
        ? await runSummarySourceWithRetry({
            key: 'catalog',
            status: sourceStatus,
            logContext: sourceLogContext,
            reasonFallback: 'catalog_fetch_failed',
            fallback: [] as Awaited<ReturnType<typeof collectCatalogFieldOptions>>,
            run: async () => collectCatalogFieldOptions(ctx.tenantId),
          })
        : [];
      if (!amoContext) {
        sourceStatus.catalog.ok = false;
        sourceStatus.catalog.reason = 'amo_unavailable';
      }

      const fieldLabelMap = buildFieldLabelMap([...getSystemLeadFieldOptions(), ...catalogOptions]);
      const selectedPipelineIds = input.pipelineIds && input.pipelineIds.length > 0
        ? input.pipelineIds
        : (amoContext?.selectedPipelineIds ?? null);
      let leadsDataAvailable = false;
      let leads: any[] = [];
      if (amoContext && (!scope.isScoped || scope.responsibleUserId)) {
        leads = await runSummarySourceWithRetry({
          key: 'leads',
          status: sourceStatus,
          logContext: sourceLogContext,
          reasonFallback: 'amo_fetch_failed',
          fallback: [] as any[],
          run: async () => {
            const fetched = await amocrmService.fetchAllLeads(
              amoContext.accessToken,
              {
                pipelineIds: selectedPipelineIds,
                responsibleUserIds: scope.isScoped ? [scope.responsibleUserId as string] : undefined,
                createdAtFrom: rangeStart,
                createdAtTo: rangeEnd,
                limit: 250,
              },
              amoContext.baseUrl,
            );
            return fetched as any[];
          },
        });
        leadsDataAvailable = sourceStatus.leads.ok;
      } else {
        sourceStatus.leads.ok = false;
        sourceStatus.leads.reason = amoContext ? 'scope_unavailable' : 'amo_unavailable';
      }

      const [pendingNotifications, activeIntegrations, totalIncomeAggregate, newSalesIncomes, incomesForSellers, callsForSellers] = await Promise.all([
        scope.isScoped
          ? Promise.resolve(0)
          : prisma.notification.count({
              where: {
                tenantId: ctx.tenantId,
                status: {
                  in: ['pending', 'retrying'],
                },
                createdAt: {
                  gte: rangeStart,
                  lte: rangeEnd,
                },
              },
            }),
        scope.isScoped
          ? Promise.resolve(0)
          : prisma.integration.count({
              where: {
                tenantId: ctx.tenantId,
                status: 'active',
              },
            }),
        prisma.income.aggregate({
          where: {
            tenantId: ctx.tenantId,
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: {
              gte: rangeStart,
              lte: rangeEnd,
            },
            ...(scope.isScoped
              ? {
                  managerUserId: ctx.user.userId,
                }
              : {}),
          },
          _sum: {
            paymentAmount: true,
          },
        }),
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'new_sale',
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: {
              gte: rangeStart,
              lte: rangeEnd,
            },
            ...(scope.isScoped
              ? {
                  managerUserId: ctx.user.userId,
                }
              : {}),
          },
          select: {
            paymentAmount: true,
            coursePriceAmount: true,
            managerUserId: true,
            course: {
              select: {
                name: true,
                category: true,
              },
            },
          },
        }),
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: {
              gte: rangeStart,
              lte: rangeEnd,
            },
            ...(scope.isScoped
              ? {
                  managerUserId: ctx.user.userId,
                }
              : {}),
          },
          select: {
            managerUserId: true,
            type: true,
            paymentAmount: true,
            coursePriceAmount: true,
            course: {
              select: {
                name: true,
                category: true,
              },
            },
          },
        }),
        prisma.call.findMany({
          where: {
            tenantId: ctx.tenantId,
            provider: 'utel',
            startedAt: {
              gte: rangeStart,
              lte: rangeEnd,
            },
          },
          select: {
            from: true,
            to: true,
            direction: true,
            duration: true,
            metadata: true,
            lead: {
              select: {
                responsibleUserId: true,
              },
            },
          },
        }),
      ]);

      let agentUsers: Array<{
        id: string;
        name: string | null;
        username: string | null;
        amocrmResponsibleUserId: string | null;
        utelManagerExternalId: string | null;
      }> = [];
      try {
        agentUsers = await prisma.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            isActive: true,
            roles: {
              hasSome: ['Agent', 'TeamLeader'],
            },
            ...(scope.isScoped
              ? {
                  id: ctx.user.userId,
                }
              : {}),
          },
          orderBy: [{ name: 'asc' }, { username: 'asc' }],
          select: {
            id: true,
            name: true,
            username: true,
            amocrmResponsibleUserId: true,
            utelManagerExternalId: true,
          },
        });
      } catch (error) {
        if (!isMissingUserMappingColumnError(error)) {
          throw error;
        }
        const fallbackUsers = await prisma.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            isActive: true,
            roles: {
              hasSome: ['Agent', 'TeamLeader'],
            },
            ...(scope.isScoped
              ? {
                  id: ctx.user.userId,
                }
              : {}),
          },
          orderBy: [{ name: 'asc' }, { username: 'asc' }],
          select: {
            id: true,
            name: true,
            username: true,
          },
        });
        agentUsers = (fallbackUsers as Array<{ id: string; name: string | null; username: string | null }>)
          .map((user) => ({
            ...user,
            amocrmResponsibleUserId: null,
            utelManagerExternalId: null,
          }));
      }

      let activityFetchMs = 0;
      const activityFetchStartedMs = Date.now();
      const activityManagerIds = agentUsers
        .map((agent) => (agent.amocrmResponsibleUserId ? String(agent.amocrmResponsibleUserId).trim() : ''))
        .filter(Boolean);
      const activityByManager = amoContext && activityManagerIds.length > 0
        ? await runSummarySourceWithRetry({
            key: 'activity',
            status: sourceStatus,
            logContext: sourceLogContext,
            reasonFallback: 'activity_fetch_failed',
            fallback: new Map(),
            run: async () => getAmoCRMActivityMetrics({
              tenantId: ctx.tenantId,
              accessToken: amoContext.accessToken,
              baseUrl: amoContext.baseUrl,
              managerIds: activityManagerIds,
              rangeStart,
              rangeEnd,
              rangeKind: input.range,
            }),
          })
        : new Map();
      if (!amoContext) {
        sourceStatus.activity.ok = false;
        sourceStatus.activity.reason = 'amo_unavailable';
      } else if (activityManagerIds.length === 0) {
        sourceStatus.activity.ok = false;
        sourceStatus.activity.reason = 'no_activity_mapping';
      }
      activityFetchMs = Date.now() - activityFetchStartedMs;
      const activityTotals = summarizeAmoCRMActivityMetrics(activityByManager);
      const corporateDurationByUserId = await runSummarySourceWithRetry({
        key: 'corporateCalls',
        status: sourceStatus,
        logContext: sourceLogContext,
        reasonFallback: 'corporate_calls_fetch_failed',
        fallback: new Map<string, number>(),
        run: async () => getCorporateCallDurationByManager({
          tenantId: ctx.tenantId,
          managerUserIds: agentUsers.map((agent) => agent.id),
          rangeStart,
          rangeEnd,
        }),
      });

      const reasonCounts = new Map<string, number>();
      const sourceCounts = new Map<string, number>();
      let qualifiedLeads = 0;
      let nonQualifiedLeads = 0;

      for (const lead of leads) {
        const reasonValue = extractLeadValue(lead, reasonFieldKey);
        const stageId = lead.status_id !== null && lead.status_id !== undefined ? String(lead.status_id) : null;
        const isQualifiedByStage = stageId ? qualifiedStageIds.includes(stageId) : false;
        const isQualified = qualifiedStageIds.length > 0
          ? isQualifiedByStage
          : isMappedValue(reasonValue, qualifiedValues);
        const isNonQualified = nonQualifiedValues.length > 0
          ? isMappedValue(reasonValue, nonQualifiedValues)
          : false;

        if (isQualified) {
          qualifiedLeads += 1;
        }

        if (isNonQualified) {
          nonQualifiedLeads += 1;
          if (reasonValue) {
            reasonCounts.set(reasonValue, (reasonCounts.get(reasonValue) ?? 0) + 1);
          }
        }

        if (sourceFieldKey) {
          const sourceValue = extractLeadValue(lead, sourceFieldKey) || 'Unknown source';
          sourceCounts.set(sourceValue, (sourceCounts.get(sourceValue) ?? 0) + 1);
        }
      }

      let onlineSalesCount = 0;
      let onlineSalesAgreementAmount = 0;
      let onlineSalesIncomeAmount = 0;
      let offlineSalesCount = 0;
      let offlineSalesAgreementAmount = 0;
      let offlineSalesIncomeAmount = 0;
      let intensiveSalesCount = 0;
      let intensiveSalesAgreementAmount = 0;
      let intensiveSalesIncomeAmount = 0;
      let newSalesAgreementAmount = 0;

      for (const income of newSalesIncomes) {
        const agreementAmount = income.coursePriceAmount ?? income.paymentAmount ?? 0;
        newSalesAgreementAmount += agreementAmount;

        const category = income.course?.category
          ? classifyCourseCategoryFromField(income.course.category)
          : classifyCourseCategoryFromField(income.course?.name);
        if (category === 'online') {
          onlineSalesCount += 1;
          onlineSalesAgreementAmount += agreementAmount;
          continue;
        }
        if (category === 'offline') {
          offlineSalesCount += 1;
          offlineSalesAgreementAmount += agreementAmount;
          continue;
        }
        if (category === 'intensive') {
          intensiveSalesCount += 1;
          intensiveSalesAgreementAmount += agreementAmount;
        }
      }

      const totalLeads = leads.length;
      const newSalesCount = newSalesIncomes.length;
      const qualifiedLeadSharePercent = totalLeads > 0 ? (qualifiedLeads / totalLeads) * 100 : 0;
      const nonQualifiedLeadSharePercent = totalLeads > 0 ? (nonQualifiedLeads / totalLeads) * 100 : 0;
      const conversionPercent = totalLeads > 0 ? (newSalesCount / totalLeads) * 100 : 0;
      const totalIncomeAmount = totalIncomeAggregate._sum.paymentAmount ?? 0;

      const leadsByResponsibleUser = new Map<string, { newLeads: number; qualifiedLeads: number }>();
      if (leadsDataAvailable) {
        for (const lead of leads) {
          const responsibleUserId = lead.responsible_user_id !== null && lead.responsible_user_id !== undefined
            ? String(lead.responsible_user_id)
            : '';
          if (!responsibleUserId) {
            continue;
          }
          const current = leadsByResponsibleUser.get(responsibleUserId) || { newLeads: 0, qualifiedLeads: 0 };
          current.newLeads += 1;

          const reasonValue = extractLeadValue(lead, reasonFieldKey);
          const stageId = lead.status_id !== null && lead.status_id !== undefined ? String(lead.status_id) : null;
          const isQualifiedByStage = stageId ? qualifiedStageIds.includes(stageId) : false;
          const isQualifiedLead = qualifiedStageIds.length > 0
            ? isQualifiedByStage
            : isMappedValue(reasonValue, qualifiedValues);
          if (isQualifiedLead) {
            current.qualifiedLeads += 1;
          }

          leadsByResponsibleUser.set(responsibleUserId, current);
        }
      }

      const salesByManager = new Map<string, { sales: number; agreementsAmount: number; incomeAmount: number }>();
      for (const income of incomesForSellers) {
        const category = income.course?.category
          ? classifyCourseCategoryFromField(income.course.category)
          : classifyCourseCategoryFromField(income.course?.name);
        const paymentAmount = income.paymentAmount ?? 0;
        if (category === 'online') {
          onlineSalesIncomeAmount += paymentAmount;
        } else if (category === 'offline') {
          offlineSalesIncomeAmount += paymentAmount;
        } else if (category === 'intensive') {
          intensiveSalesIncomeAmount += paymentAmount;
        }

        const current = salesByManager.get(income.managerUserId) || {
          sales: 0,
          agreementsAmount: 0,
          incomeAmount: 0,
        };

        current.incomeAmount += paymentAmount;
        if (income.type === 'new_sale') {
          current.sales += 1;
          current.agreementsAmount += income.coursePriceAmount ?? income.paymentAmount ?? 0;
        }

        salesByManager.set(income.managerUserId, current);
      }

      const talkSecondsByAgent = new Map<string, number>();
      const callCountByAgent = new Map<string, number>();
      for (const agent of agentUsers) {
        const keyByUtel = normalizeTextToken(agent.utelManagerExternalId);
        const extensionByUtel = normalizeDigits(agent.utelManagerExternalId);
        const keyByAmo = normalizeTextToken(agent.amocrmResponsibleUserId);
        const hasCallMapping = Boolean(
          keyByUtel
          || keyByAmo
          || (extensionByUtel && isAllowedUtelManagerExtension(extensionByUtel)),
        );
        const manualDurationSeconds = corporateDurationByUserId.get(agent.id) || 0;

        if (!hasCallMapping && manualDurationSeconds <= 0) {
          continue;
        }

        let talkSeconds = 0;
        let callCount = 0;
        for (const call of callsForSellers) {
          const callLeadResponsibleId = normalizeTextToken(call.lead?.responsibleUserId);
          const metadataKey = extractUtelManagerKey(call.metadata);
          const normalizedMetadataKey = normalizeTextToken(metadataKey);
          const callExtension = resolveCallExtension({
            from: call.from,
            to: call.to,
            direction: call.direction,
            metadata: call.metadata,
          });
          const normalizedCallExtension = normalizeDigits(callExtension);
          const matched = (keyByAmo && callLeadResponsibleId && keyByAmo === callLeadResponsibleId)
            || (keyByUtel && normalizedMetadataKey && keyByUtel === normalizedMetadataKey)
            || (extensionByUtel && normalizedCallExtension && extensionByUtel === normalizedCallExtension);

          if (matched) {
            callCount += 1;
            const callDuration = Math.max(0, call.duration ?? 0);
            talkSeconds += callDuration;
          }
        }

        talkSecondsByAgent.set(agent.id, talkSeconds + manualDurationSeconds);
        callCountByAgent.set(agent.id, callCount);
      }

      const scopedTotalCalls = scope.isScoped
        ? (callCountByAgent.get(ctx.user.userId) ?? 0)
        : callsForSellers.length;

      const sellerPerformance = agentUsers
        .map((agent) => {
          const responsibleUserId = agent.amocrmResponsibleUserId ? String(agent.amocrmResponsibleUserId) : '';
          const leadStats = responsibleUserId ? leadsByResponsibleUser.get(responsibleUserId) : undefined;
          const salesStats = salesByManager.get(agent.id) || {
            sales: 0,
            agreementsAmount: 0,
            incomeAmount: 0,
          };
          const activityStats = responsibleUserId
            ? activityByManager.get(responsibleUserId) || {
                followUpCount: 0,
                noteCount: 0,
                stageChangeCount: 0,
                overdueFollowUpCount: 0,
                todayFollowUpCount: 0,
              }
            : {
                followUpCount: 0,
                noteCount: 0,
                stageChangeCount: 0,
                overdueFollowUpCount: 0,
                todayFollowUpCount: 0,
              };
          const talkSeconds = talkSecondsByAgent.get(agent.id);
          const leadMetricsAvailable = leadsDataAvailable && Boolean(responsibleUserId);
          const conversionPercentByAgent = leadMetricsAvailable && (leadStats?.newLeads ?? 0) > 0
            ? Number(((salesStats.sales / (leadStats?.newLeads || 0)) * 100).toFixed(2))
            : (leadMetricsAvailable ? 0 : null);
          const talkedSecondsValue = talkSecondsByAgent.has(agent.id)
            ? (talkSeconds ?? 0)
            : null;

          return {
            userId: agent.id,
            name: agent.name || agent.username || agent.id,
            newLeads: leadMetricsAvailable ? (leadStats?.newLeads ?? 0) : null,
            qualifiedLeads: leadMetricsAvailable ? (leadStats?.qualifiedLeads ?? 0) : null,
            sales: salesStats.sales,
            conversionPercent: conversionPercentByAgent,
            agreementsAmount: tashkiliyOnly ? 0 : salesStats.agreementsAmount,
            incomeAmount: tashkiliyOnly ? 0 : salesStats.incomeAmount,
            talkedSeconds: talkedSecondsValue,
            callsCount: callCountByAgent.get(agent.id) ?? 0,
            followUpCount: activityStats.followUpCount,
            noteCount: activityStats.noteCount,
            stageChangeCount: activityStats.stageChangeCount,
            overdueFollowUpCount: activityStats.overdueFollowUpCount,
            todayFollowUpCount: activityStats.todayFollowUpCount,
          };
        })
        .sort((a, b) => {
          const aDuration = a.talkedSeconds ?? -1;
          const bDuration = b.talkedSeconds ?? -1;
          if (bDuration !== aDuration) {
            return bDuration - aDuration;
          }
          return a.name.localeCompare(b.name, 'uz');
        });

      log(LogLevel.INFO, 'Dashboard summary activity timings', {
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        activityFetchMs,
        activityManagerCount: activityManagerIds.length,
        activityTotals,
      });

      return {
        range: input.range,
        dateFrom: input.range === 'custom' ? input.dateFrom || null : null,
        dateTo: input.range === 'custom' ? input.dateTo || null : null,
        selectedPipelineIds: selectedPipelineIds || [],
        sourceStatus,
        sellerPerformance,
        summary: {
          totalLeads,
          qualifiedLeads,
          nonQualifiedLeads,
          totalCalls: scopedTotalCalls,
          pendingNotifications,
          activeIntegrations,
          totalIncomeAmount: tashkiliyOnly ? 0 : totalIncomeAmount,
          newSalesCount,
          newSalesAgreementAmount: tashkiliyOnly ? 0 : newSalesAgreementAmount,
          onlineSalesCount,
          onlineSalesAgreementAmount: tashkiliyOnly ? 0 : onlineSalesAgreementAmount,
          onlineSalesIncomeAmount: tashkiliyOnly ? 0 : onlineSalesIncomeAmount,
          offlineSalesCount,
          offlineSalesAgreementAmount: tashkiliyOnly ? 0 : offlineSalesAgreementAmount,
          offlineSalesIncomeAmount: tashkiliyOnly ? 0 : offlineSalesIncomeAmount,
          intensiveSalesCount,
          intensiveSalesAgreementAmount: tashkiliyOnly ? 0 : intensiveSalesAgreementAmount,
          intensiveSalesIncomeAmount: tashkiliyOnly ? 0 : intensiveSalesIncomeAmount,
          qualifiedLeadSharePercent: Number(qualifiedLeadSharePercent.toFixed(2)),
          nonQualifiedLeadSharePercent: Number(nonQualifiedLeadSharePercent.toFixed(2)),
          conversionPercent: Number(conversionPercent.toFixed(2)),
          followUpCount: activityTotals.followUpCount,
          noteCount: activityTotals.noteCount,
          stageChangeCount: activityTotals.stageChangeCount,
          overdueFollowUpCount: activityTotals.overdueFollowUpCount,
          todayFollowUpCount: activityTotals.todayFollowUpCount,
        },
        pieCharts: {
          nonQualifiedByReason: {
            fieldKey: reasonFieldKey,
            fieldLabel: reasonFieldKey ? (fieldLabelMap.get(reasonFieldKey) || humanizeKey(reasonFieldKey)) : null,
            data: toPieData(reasonCounts),
          },
          newLeadsBySource: {
            fieldKey: sourceFieldKey,
            fieldLabel: sourceFieldKey ? (fieldLabelMap.get(sourceFieldKey) || humanizeKey(sourceFieldKey)) : null,
            data: toPieData(sourceCounts),
          },
        },
        updatedAt: now.toISOString(),
      };
      }); // end getOrSet
    }),

  financeSummary: protectedProcedure
    .input(
      z.object({
        range: dashboardRangeSchema,
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        courseId: z.string().uuid().optional(),
        managerUserId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (isTashkiliyOnly(ctx.user.roles)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Tashkiliy role cannot access finance summary.' });
      }

      const financeCacheKey = buildCacheKey('financeSummary', {
        t: ctx.tenantId,
        u: ctx.user.userId,
        r: input.range,
        df: input.dateFrom,
        dt: input.dateTo,
        c: input.courseId,
        m: input.managerUserId,
      });
      return getOrSet(financeCacheKey, 120, async () => {
      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);

      const effectiveManagerUserId = scope.isScoped
        ? ctx.user.userId
        : (input.managerUserId || undefined);

      const where = {
        tenantId: ctx.tenantId,
        entryDate: {
          gte: rangeStart,
          lte: rangeEnd,
        },
        ...(effectiveManagerUserId
          ? {
              managerUserId: effectiveManagerUserId,
            }
          : {}),
        ...(input.courseId
          ? {
              courseId: input.courseId,
            }
          : {}),
      };
      const analyticsBaseWhere = {
        tenantId: ctx.tenantId,
        ...(effectiveManagerUserId
          ? {
              managerUserId: effectiveManagerUserId,
            }
          : {}),
        ...(input.courseId
          ? {
              courseId: input.courseId,
            }
          : {}),
      };

      const nowLocal = shiftToReportTimezone(now);
      const currentYear = nowLocal.getUTCFullYear();
      const currentMonth = nowLocal.getUTCMonth();
      const currentDay = nowLocal.getUTCDate();
      const currentHour = nowLocal.getUTCHours();
      const currentMinute = nowLocal.getUTCMinutes();
      const currentSecond = nowLocal.getUTCSeconds();
      const currentMillisecond = nowLocal.getUTCMilliseconds();

      const previousMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
      const previousMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      const previousMonthSameDay = Math.min(currentDay, getDaysInReportLocalMonth(previousMonthYear, previousMonth));
      const lastYearSameMonthDay = Math.min(currentDay, getDaysInReportLocalMonth(currentYear - 1, currentMonth));
      const currentMonthTotalDays = getDaysInReportLocalMonth(currentYear, currentMonth);

      const currentMonthStart = fromReportLocalParts(currentYear, currentMonth, 1, 0, 0, 0, 0);
      const previousMonthStart = fromReportLocalParts(previousMonthYear, previousMonth, 1, 0, 0, 0, 0);
      const previousMonthSameMoment = fromReportLocalParts(
        previousMonthYear,
        previousMonth,
        previousMonthSameDay,
        currentHour,
        currentMinute,
        currentSecond,
        currentMillisecond,
      );
      const lastYearSameMonthStart = fromReportLocalParts(currentYear - 1, currentMonth, 1, 0, 0, 0, 0);
      const lastYearSameMonthMoment = fromReportLocalParts(
        currentYear - 1,
        currentMonth,
        lastYearSameMonthDay,
        currentHour,
        currentMinute,
        currentSecond,
        currentMillisecond,
      );
      const currentYearStart = fromReportLocalParts(currentYear, 0, 1, 0, 0, 0, 0);
      const previousYearStart = fromReportLocalParts(currentYear - 1, 0, 1, 0, 0, 0, 0);
      const previousYearYtdMoment = fromReportLocalParts(
        currentYear - 1,
        currentMonth,
        lastYearSameMonthDay,
        currentHour,
        currentMinute,
        currentSecond,
        currentMillisecond,
      );

      const sumActiveIncome = async (start: Date, end: Date): Promise<number> => {
        const aggregate = await prisma.income.aggregate({
          where: {
            ...analyticsBaseWhere,
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: {
              gte: start,
              lte: end,
            },
          },
          _sum: {
            paymentAmount: true,
          },
        });
        return Number(aggregate._sum.paymentAmount || 0);
      };

      const [
        incomes,
        courses,
        managers,
        currentMonthToDateIncome,
        previousMonthToDateIncome,
        lastYearSameMonthToDateIncome,
        currentYearToDateIncome,
        previousYearToDateIncome,
        monthActiveIncomes,
        yearActiveIncomes,
      ] = await Promise.all([
        prisma.income.findMany({
          where,
          orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
          take: 300,
          select: {
            id: true,
            type: true,
            lifecycleStatus: true,
            paymentAmount: true,
            coursePriceAmount: true,
            remainingDebtAmount: true,
            entryDate: true,
            customerId: true,
            customer: {
              select: {
                customerNumber: true,
                name: true,
              },
            },
            manager: {
              select: {
                id: true,
                name: true,
                username: true,
              },
            },
            course: {
              select: {
                id: true,
                name: true,
              },
            },
            tariff: {
              select: {
                name: true,
              },
            },
          },
        }),
        prisma.course.findMany({
          where: { tenantId: ctx.tenantId, isActive: true },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            category: true,
          },
        }),
        prisma.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            isActive: true,
            roles: {
              hasSome: ['Admin', 'Manager', 'TeamLeader', 'Agent'],
            },
          },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            username: true,
            roles: true,
          },
        }),
        sumActiveIncome(currentMonthStart, now),
        sumActiveIncome(previousMonthStart, previousMonthSameMoment),
        sumActiveIncome(lastYearSameMonthStart, lastYearSameMonthMoment),
        sumActiveIncome(currentYearStart, now),
        sumActiveIncome(previousYearStart, previousYearYtdMoment),
        prisma.income.findMany({
          where: {
            ...analyticsBaseWhere,
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: {
              gte: currentMonthStart,
              lte: now,
            },
          },
          select: {
            entryDate: true,
            paymentAmount: true,
          },
        }),
        prisma.income.findMany({
          where: {
            ...analyticsBaseWhere,
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: {
              gte: currentYearStart,
              lte: now,
            },
          },
          select: {
            entryDate: true,
            paymentAmount: true,
          },
        }),
      ]);

      const totals = {
        totalIncomeAmount: 0,
        newSalesCount: 0,
        repaymentCount: 0,
        refundCount: 0,
        refundAmount: 0,
        debtorsCount: 0,
        totalDebtAmount: 0,
      };

      const debtorCustomers = new Set<string>();
      const incomeByCourse = new Map<string, { count: number; amount: number; agreementAmount: number }>();
      const incomeByAgent = new Map<string, { count: number; amount: number }>();
      const activeNewSales = (incomes as Array<{
        id: string;
        type: string;
        lifecycleStatus: string;
        entryDate: Date;
        coursePriceAmount: number | null;
        paymentAmount: number;
      }>)
        .filter((income) => income.type === 'new_sale' && income.lifecycleStatus === INCOME_LIFECYCLE_ACTIVE)
        .map((sale) => ({
          id: sale.id,
          entryDate: sale.entryDate,
          coursePriceAmount: sale.coursePriceAmount,
          paymentAmount: sale.paymentAmount,
          debtAmount: sale.coursePriceAmount,
        }));
      const activeSaleChainMetricsBySaleId = activeNewSales.length > 0
        ? buildSaleChainMetricsBySaleId({
            sales: activeNewSales,
            chainRows: await prisma.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
                OR: [
                  { id: { in: activeNewSales.map((sale) => sale.id) } },
                  { relatedDebtIncomeId: { in: activeNewSales.map((sale) => sale.id) } },
                ],
              },
              select: {
                id: true,
                relatedDebtIncomeId: true,
                paymentAmount: true,
                entryDate: true,
              },
            }),
          })
        : new Map<string, { currentDebtAmount: number }>();

      for (const income of incomes as Array<{
        id: string;
        type: string;
        lifecycleStatus: string;
        paymentAmount: number;
        coursePriceAmount: number | null;
        remainingDebtAmount: number;
        entryDate: Date;
        customerId: string;
        customer: { customerNumber: string; name: string };
        manager: { id: string; name: string | null; username: string | null };
        course: { id: string; name: string } | null;
        tariff: { name: string } | null;
      }>) {
        if (income.lifecycleStatus === INCOME_LIFECYCLE_REFUNDED) {
          totals.refundCount += 1;
          totals.refundAmount += income.paymentAmount || 0;
        }

        if (income.lifecycleStatus !== INCOME_LIFECYCLE_ACTIVE) {
          continue;
        }

        const paymentAmount = income.paymentAmount || 0;
        totals.totalIncomeAmount += paymentAmount;

        const courseName = income.course?.name || 'No course';
        const byCourse = incomeByCourse.get(courseName) || {
          count: 0,
          amount: 0,
          agreementAmount: 0,
        };
        byCourse.count += 1;
        byCourse.amount += paymentAmount;
        if (income.type === 'new_sale') {
          byCourse.agreementAmount += income.coursePriceAmount || paymentAmount;
        }
        incomeByCourse.set(courseName, byCourse);

        const agentLabel = income.manager.name || income.manager.username || income.manager.id;
        const byAgent = incomeByAgent.get(agentLabel) || {
          count: 0,
          amount: 0,
        };
        byAgent.count += 1;
        byAgent.amount += paymentAmount;
        incomeByAgent.set(agentLabel, byAgent);

        if (income.type === 'new_sale') {
          totals.newSalesCount += 1;
          const chainDebt = activeSaleChainMetricsBySaleId.get(income.id)?.currentDebtAmount ?? income.remainingDebtAmount;
          if (chainDebt > 0) {
            debtorCustomers.add(income.customerId);
            totals.totalDebtAmount += chainDebt;
          }
        } else if (income.type === 'repayment') {
          totals.repaymentCount += 1;
        }
      }

      totals.debtorsCount = debtorCustomers.size;
      const monthTrend = buildTrend(currentMonthToDateIncome, previousMonthToDateIncome);
      const monthVsLastYearTrend = buildTrend(currentMonthToDateIncome, lastYearSameMonthToDateIncome);
      const ytdTrend = buildTrend(currentYearToDateIncome, previousYearToDateIncome);

      const monthDailyMap = new Map<number, number>();
      for (const income of monthActiveIncomes as Array<{ entryDate: Date; paymentAmount: number }>) {
        const localDate = shiftToReportTimezone(income.entryDate);
        const day = localDate.getUTCDate();
        monthDailyMap.set(day, (monthDailyMap.get(day) || 0) + Number(income.paymentAmount || 0));
      }

      let monthCumulativeActual = 0;
      const monthElapsedDays = Math.max(1, currentDay);
      const monthRunRatePerDay = currentMonthToDateIncome > 0 ? currentMonthToDateIncome / monthElapsedDays : 0;
      const monthForecastSeries: Array<{ label: string; actual: number | null; forecast: number }> = [];
      for (let day = 1; day <= currentMonthTotalDays; day += 1) {
        monthCumulativeActual += monthDailyMap.get(day) || 0;
        monthForecastSeries.push({
          label: String(day),
          actual: day <= currentDay ? Math.round(monthCumulativeActual) : null,
          forecast: Math.round(monthRunRatePerDay * day),
        });
      }

      const monthProjectedTotal = Math.round(monthRunRatePerDay * currentMonthTotalDays);
      const monthRemainingAmount = Math.max(0, monthProjectedTotal - Math.round(currentMonthToDateIncome));
      const monthProgressPercent = monthProjectedTotal > 0
        ? Number(((currentMonthToDateIncome / monthProjectedTotal) * 100).toFixed(2))
        : 0;

      const yearMonthlyMap = new Map<number, number>();
      for (const income of yearActiveIncomes as Array<{ entryDate: Date; paymentAmount: number }>) {
        const localDate = shiftToReportTimezone(income.entryDate);
        const monthIndex = localDate.getUTCMonth();
        yearMonthlyMap.set(monthIndex, (yearMonthlyMap.get(monthIndex) || 0) + Number(income.paymentAmount || 0));
      }

      const yearElapsedDays = Math.max(1, getReportLocalDayOfYear(now));
      const yearTotalDays = getReportLocalDaysInYear(currentYear);
      const yearRunRatePerDay = currentYearToDateIncome > 0 ? currentYearToDateIncome / yearElapsedDays : 0;
      let yearCumulativeActual = 0;
      const yearForecastSeries: Array<{ label: string; actual: number | null; forecast: number }> = [];
      for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        yearCumulativeActual += yearMonthlyMap.get(monthIndex) || 0;
        yearForecastSeries.push({
          label: REPORT_MONTH_LABELS_UZ[monthIndex] || String(monthIndex + 1),
          actual: monthIndex <= currentMonth ? Math.round(yearCumulativeActual) : null,
          forecast: Math.round(yearRunRatePerDay * getReportLocalDayOfYearForMonthEnd(currentYear, monthIndex)),
        });
      }

      const yearProjectedTotal = Math.round(yearRunRatePerDay * yearTotalDays);
      const yearRemainingAmount = Math.max(0, yearProjectedTotal - Math.round(currentYearToDateIncome));
      const yearProgressPercent = yearProjectedTotal > 0
        ? Number(((currentYearToDateIncome / yearProjectedTotal) * 100).toFixed(2))
        : 0;

      const managerOptions = (managers as Array<{ id: string; name: string | null; username: string | null; roles: string[] }>)
        .map((manager) => ({
          id: manager.id,
          label: manager.name || manager.username || manager.id,
          roles: manager.roles,
        }));
      const visibleManagerOptions = scope.isScoped
        ? managerOptions.filter((manager) => manager.id === ctx.user.userId)
        : managerOptions;

      return {
        range: input.range,
        dateFrom: input.range === 'custom' ? input.dateFrom || null : null,
        dateTo: input.range === 'custom' ? input.dateTo || null : null,
        filters: {
          courseId: input.courseId || null,
          managerUserId: effectiveManagerUserId || null,
          agentScoped: scope.isScoped,
        },
        comparisons: {
          monthToDateVsLastMonthToDate: {
            ...monthTrend,
            currentStart: currentMonthStart.toISOString(),
            currentEnd: now.toISOString(),
            previousStart: previousMonthStart.toISOString(),
            previousEnd: previousMonthSameMoment.toISOString(),
          },
          monthToDateVsLastYearSameMonth: {
            ...monthVsLastYearTrend,
            currentStart: currentMonthStart.toISOString(),
            currentEnd: now.toISOString(),
            previousStart: lastYearSameMonthStart.toISOString(),
            previousEnd: lastYearSameMonthMoment.toISOString(),
          },
          ytdVsLastYearYtd: {
            ...ytdTrend,
            currentStart: currentYearStart.toISOString(),
            currentEnd: now.toISOString(),
            previousStart: previousYearStart.toISOString(),
            previousEnd: previousYearYtdMoment.toISOString(),
          },
        },
        forecast: {
          monthEnd: {
            currentToDate: Math.round(currentMonthToDateIncome),
            projectedTotal: monthProjectedTotal,
            remainingAmount: monthRemainingAmount,
            progressPercent: monthProgressPercent,
            runRatePerDay: Number(monthRunRatePerDay.toFixed(2)),
            periodStart: currentMonthStart.toISOString(),
            periodEnd: fromReportLocalParts(currentYear, currentMonth, currentMonthTotalDays, 23, 59, 59, 999).toISOString(),
          },
          yearEnd: {
            currentToDate: Math.round(currentYearToDateIncome),
            projectedTotal: yearProjectedTotal,
            remainingAmount: yearRemainingAmount,
            progressPercent: yearProgressPercent,
            runRatePerDay: Number(yearRunRatePerDay.toFixed(2)),
            periodStart: currentYearStart.toISOString(),
            periodEnd: fromReportLocalParts(currentYear, 11, 31, 23, 59, 59, 999).toISOString(),
          },
          monthSeries: monthForecastSeries,
          yearSeries: yearForecastSeries,
        },
        totals,
        incomeByCourse: Array.from(incomeByCourse.entries())
          .map(([courseName, value]) => ({
            courseName,
            count: value.count,
            amount: value.amount,
            agreementAmount: value.agreementAmount,
          }))
          .sort((a, b) => b.amount - a.amount),
        incomeByAgent: Array.from(incomeByAgent.entries())
          .map(([agent, value]) => ({
            agent,
            count: value.count,
            amount: value.amount,
          }))
          .sort((a, b) => b.amount - a.amount),
        courseOptions: (courses as Array<{ id: string; name: string; category: string }>).map((course) => ({
          ...course,
          category: classifyCourseCategoryFromField(course.category || course.name),
        })),
        managerOptions: visibleManagerOptions,
        recentIncomes: (incomes as Array<{
          id: string;
          type: string;
          lifecycleStatus: string;
          paymentAmount: number;
          coursePriceAmount: number | null;
          remainingDebtAmount: number;
          entryDate: Date;
          customer: { customerNumber: string; name: string };
          manager: { id: string; name: string | null; username: string | null };
          course: { id: string; name: string } | null;
          tariff: { name: string } | null;
        }>).map((income) => ({
          id: income.id,
          type: income.type,
          lifecycleStatus: income.lifecycleStatus,
          paymentAmount: income.paymentAmount,
          coursePriceAmount: income.coursePriceAmount,
          remainingDebtAmount: income.remainingDebtAmount,
          entryDate: income.entryDate,
          customerNumber: income.customer.customerNumber,
          customerName: income.customer.name,
          managerLabel: income.manager.name || income.manager.username || income.manager.id,
          courseName: income.course?.name || null,
          tariffName: income.tariff?.name || null,
        })),
        updatedAt: now.toISOString(),
      };
      }); // end getOrSet
    }),
};
