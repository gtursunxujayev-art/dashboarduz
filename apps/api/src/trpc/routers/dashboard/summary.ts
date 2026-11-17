import { AGENT_ROLES, isTashkiliyOnly, normalizeDigits, reportRangeSchema } from '@dashboarduz/shared';

import { getAgentResponsibleScope } from '../../../lib/access';
import { withTimeout } from '../../../lib/async';
import { resolveDateRange } from '../../../lib/dates';
import { logger } from '../../../lib/logger';
import { asObject } from '../../../lib/object';
import { isAllowedUtelManagerExtension, resolveCallDuration, resolveCallExtension } from '../../../lib/utel';
import { buildCacheKey, getOrSet } from '../../../services/cache';
import { getCallsProvider } from '../../../services/calls-source';
import { getCorporateCallDurationByManager } from '../../../services/corporate-call-durations';
import { createSummarySourceStatus, runSummarySourceWithRetry } from '../../../services/dashboard/summary-sources';
import { INCOME_LIFECYCLE_ACTIVE } from '../../../services/income-chain';
import { excludeTechnicalRows, loadTechnicalSaleIdsForRows, resolveSaleAgreementAmount } from '../../../services/income-facts';

import { asStringArray, buildFieldLabelMap, classifyCourseCategoryFromField, collectCatalogFieldOptions, createAmoCRMActivityDiagnostics, extractLeadValue, extractUtelManagerKey, fetchSnapshotLeads, getAmoCRMActivityMetrics, getSystemLeadFieldOptions, getTenantAmoCRMContext, humanizeKey, isMappedValue, normalizeTextToken, protectedProcedure, summarizeAmoCRMActivityMetrics, toPieData, TRPCError, z } from './helpers';

export const summaryProcedures = {
  summary: protectedProcedure
    .input(
      z.object({
        range: reportRangeSchema,
        pipelineIds: z.array(z.string()).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        refreshKey: z.number().int().nonnegative().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const corporateRevision = await ctx.db.corporateCallDuration.aggregate({
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
        refresh: input.refreshKey === undefined ? undefined : String(input.refreshKey),
        cr: corporateRevisionKey,
      });

      return getOrSet(cacheKey, 120, async () => {
      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const tashkiliyOnly = isTashkiliyOnly(ctx.user.roles);
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);
      const tenant = await ctx.db.tenant.findUnique({
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
        run: async () => withTimeout(getTenantAmoCRMContext(ctx.tenantId, ctx.db), 2500, 'amo_context_timeout'),
      });

      if (!amoContext) {
        sourceStatus.amoContext.ok = false;
        sourceStatus.amoContext.reason = sourceStatus.amoContext.reason || 'amo_not_connected';
        sourceStatus.amoContext.state = 'unavailable';
      }

      const catalogOptions = amoContext
        ? await runSummarySourceWithRetry({
            key: 'catalog',
            status: sourceStatus,
            logContext: sourceLogContext,
            reasonFallback: 'catalog_fetch_failed',
            fallback: [] as Awaited<ReturnType<typeof collectCatalogFieldOptions>>,
            run: async () => withTimeout(collectCatalogFieldOptions(ctx.tenantId, ctx.db), 2500, 'catalog_timeout'),
          })
        : [];

      if (!amoContext) {
        sourceStatus.catalog.ok = false;
        sourceStatus.catalog.reason = 'amo_unavailable';
        sourceStatus.catalog.state = 'unavailable';
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
            const fetched = await withTimeout(
              fetchSnapshotLeads(
                ctx.tenantId,
                {
                  pipelineIds: selectedPipelineIds,
                  responsibleUserIds: scope.isScoped ? [scope.responsibleUserId as string] : undefined,
                  createdAtFrom: rangeStart,
                  createdAtTo: rangeEnd,
                },
                ctx.db,
              ),
              3000,
              'amo_leads_timeout',
            );

            return fetched as any[];
          },
        });
        leadsDataAvailable = sourceStatus.leads.ok;
      } else {
        sourceStatus.leads.ok = false;
        sourceStatus.leads.reason = amoContext ? 'scope_unavailable' : 'amo_unavailable';
        sourceStatus.leads.state = 'unavailable';
      }

      const [pendingNotifications, activeIntegrations, newSalesIncomesRaw, incomesForSellersRaw, callsForSellers] = await Promise.all([
        scope.isScoped
          ? Promise.resolve(0)
          : ctx.db.notification.count({
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
          : ctx.db.integration.count({
              where: {
                tenantId: ctx.tenantId,
                status: 'active',
              },
            }),
        ctx.db.income.findMany({
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
            id: true,
            type: true,
            relatedDebtIncomeId: true,
            paymentAmount: true,
            coursePriceAmount: true,
            debtAmount: true,
            managerUserId: true,
            course: {
              select: {
                name: true,
                category: true,
              },
            },
          },
        }),
        ctx.db.income.findMany({
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
            id: true,
            relatedDebtIncomeId: true,
            managerUserId: true,
            type: true,
            paymentAmount: true,
            coursePriceAmount: true,
            debtAmount: true,
            course: {
              select: {
                name: true,
                category: true,
              },
            },
          },
        }),
        ctx.db.call.findMany({
          where: {
            tenantId: ctx.tenantId,
            provider: await getCallsProvider(ctx.tenantId, ctx.db),
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

      // Technical sales (agreement == 1) and their repayments are bookkeeping rows, not real income.
      const technicalSaleIds = await loadTechnicalSaleIdsForRows(ctx.tenantId, incomesForSellersRaw, ctx.db);
      const newSalesIncomes = excludeTechnicalRows(newSalesIncomesRaw, technicalSaleIds);
      const incomesForSellers = excludeTechnicalRows(incomesForSellersRaw, technicalSaleIds);

      let agentUsers: Array<{
        id: string;
        name: string | null;
        username: string | null;
        amocrmResponsibleUserId: string | null;
        utelManagerExternalId: string | null;
      }> = [];

      agentUsers = await ctx.db.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          roles: {
            hasSome: [...AGENT_ROLES, 'TeamLeader'],
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

      let activityFetchMs = 0;
      const activityFetchStartedMs = Date.now();
      const activityManagerIds = agentUsers
        .map((agent) => (agent.amocrmResponsibleUserId ? String(agent.amocrmResponsibleUserId).trim() : ''))
        .filter(Boolean);
      const activityDiagnostics = createAmoCRMActivityDiagnostics();
      const activityByManager = amoContext && activityManagerIds.length > 0
        ? await runSummarySourceWithRetry({
            key: 'activity',
            status: sourceStatus,
            logContext: sourceLogContext,
            reasonFallback: 'activity_fetch_failed',
            fallback: new Map(),
            run: async () => withTimeout(
              getAmoCRMActivityMetrics({
                tenantId: ctx.tenantId,
                accessToken: amoContext.accessToken,
                baseUrl: amoContext.baseUrl,
                managerIds: activityManagerIds,
                rangeStart,
                rangeEnd,
                rangeKind: input.range,
                diagnostics: activityDiagnostics,
              }),
              15_000,
              'amo_activity_timeout',
            ),
          })
        : new Map();

      if (!amoContext) {
        sourceStatus.activity.ok = false;
        sourceStatus.activity.reason = 'amo_unavailable';
        sourceStatus.activity.state = 'unavailable';
      } else if (activityManagerIds.length === 0) {
        sourceStatus.activity.ok = false;
        sourceStatus.activity.reason = 'no_activity_mapping';
        sourceStatus.activity.state = 'mapping_missing';
      } else if (sourceStatus.activity.ok) {
        const activitySources = Object.values(activityDiagnostics);
        const failedSources = activitySources.filter((source) => !source.ok);

        if (failedSources.length > 0) {
          sourceStatus.activity.ok = false;
          sourceStatus.activity.reason = failedSources.map((source) => source.reason).filter(Boolean).join(',') || 'partial';
          sourceStatus.activity.state = failedSources.length === activitySources.length ? 'unavailable' : 'partial';
        }
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
          db: ctx.db,
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
        const agreementAmount = resolveSaleAgreementAmount(income);

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
      const totalIncomeAmount = incomesForSellers.reduce((sum, income) => sum + (income.paymentAmount ?? 0), 0);

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
          current.agreementsAmount += resolveSaleAgreementAmount(income);
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
            // Same duration rule as the live leaderboard: fall back to the duration stored in call metadata.
            const callDuration = resolveCallDuration(call.duration, call.metadata);

            talkSeconds += callDuration;
          }
        }

        talkSecondsByAgent.set(agent.id, talkSeconds + manualDurationSeconds);
        callCountByAgent.set(agent.id, callCount);
      }

      const scopedTotalCalls = scope.isScoped
        ? (callCountByAgent.get(ctx.user.userId) ?? 0)
        : callsForSellers.length;

      const unmappedSellerNames = agentUsers
        .filter((agent) => !String(agent.amocrmResponsibleUserId || '').trim())
        .map((agent) => agent.name || agent.username || agent.id);

      if (amoContext && activityManagerIds.length > 0 && unmappedSellerNames.length > 0) {
        sourceStatus.activity.ok = false;
        sourceStatus.activity.state = 'partial';
        sourceStatus.activity.reason = [sourceStatus.activity.reason, 'mapping_missing'].filter(Boolean).join(',');
      }
      const activityRequestUnavailable = sourceStatus.activity.state === 'timeout'
        || sourceStatus.activity.state === 'unavailable';

      const sellerPerformance = agentUsers
        .map((agent) => {
          const responsibleUserId = agent.amocrmResponsibleUserId ? String(agent.amocrmResponsibleUserId) : '';
          const crmMapped = Boolean(responsibleUserId);
          const crmAvailability = {
            mapped: crmMapped,
            completedTasks: crmMapped && !activityRequestUnavailable && activityDiagnostics.completedTasks.ok,
            pendingTasks: crmMapped && !activityRequestUnavailable && activityDiagnostics.pendingTasks.ok,
            events: crmMapped && !activityRequestUnavailable && activityDiagnostics.events.ok,
          };
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
            followUpCount: crmAvailability.completedTasks ? activityStats.followUpCount : null,
            noteCount: crmAvailability.events ? activityStats.noteCount : null,
            stageChangeCount: crmAvailability.events ? activityStats.stageChangeCount : null,
            overdueFollowUpCount: crmAvailability.pendingTasks ? activityStats.overdueFollowUpCount : null,
            todayFollowUpCount: crmAvailability.pendingTasks ? activityStats.todayFollowUpCount : null,
            crmAvailability,
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

      logger.info({
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        activityFetchMs,
        activityManagerCount: activityManagerIds.length,
        activityTotals,
      }, 'Dashboard summary activity timings');

      return {
        range: input.range,
        dateFrom: input.range === 'custom' ? input.dateFrom || null : null,
        dateTo: input.range === 'custom' ? input.dateTo || null : null,
        selectedPipelineIds: selectedPipelineIds || [],
        sourceStatus,
        unmappedSellerNames,
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
};
