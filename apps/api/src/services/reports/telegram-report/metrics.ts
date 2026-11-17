import { systemPrisma } from '@dashboarduz/db';
import { type ManagerGroup } from '@dashboarduz/shared';

import { logger } from '../../../lib/logger';
import { roundPositivePercentage } from '../../../lib/number';
import { AMOCRM_CALL_PROVIDER, countedCallsWhere } from '../../calls-source';
import { getCorporateCallDurationByManager, getCorporateCallDurationTotal } from '../../corporate-call-durations';
import { buildTechnicalSaleIdSet, classifyIncomeCategory, excludeTechnicalRows, loadTechnicalSaleIdsForRows, resolveSaleAgreementAmount } from '../../income-facts';
import { amocrmService } from '../../integrations/amocrm';
import { extractLeadValue, getTenantAmoCRMContext } from '../../integrations/amocrm-live';

import { classifyManagerGroup, compareManagerRows, isLostLeadStatus } from './format';
import { LONG_CALL_MIN_SECONDS, type ReportManagerRow, type ReportMetrics } from './types';

function buildLeadWhere(
  tenantId: string,
  periodStart: Date,
  periodEnd: Date,
  pipelineIds: string[],
): Record<string, unknown> {
  const baseWhere: Record<string, unknown> = {
    tenantId,
    amocrmId: { not: null },
    OR: [
      { externalCreatedAt: { gte: periodStart, lte: periodEnd } },
      {
        externalCreatedAt: null,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    ],
  };

  if (pipelineIds.length > 0) {
    baseWhere.pipelineId = { in: pipelineIds };
  }

  return baseWhere;
}

export async function collectMetrics(params: {
  tenantId: string;
  tenantSettings: unknown;
  periodStart: Date;
  periodEnd: Date;
  selectedPipelineIds: string[];
  selectedReportCourseIds: string[];
}): Promise<ReportMetrics> {
  const dashboardSettings = (
    params.tenantSettings
    && typeof params.tenantSettings === 'object'
    && !Array.isArray(params.tenantSettings)
    && (params.tenantSettings as Record<string, unknown>).dashboard
    && typeof (params.tenantSettings as Record<string, unknown>).dashboard === 'object'
      ? (params.tenantSettings as Record<string, unknown>).dashboard as Record<string, unknown>
      : {}
  );

  const qualifiedStageIds = Array.isArray(dashboardSettings.qualifiedStageIds)
    ? dashboardSettings.qualifiedStageIds.map((value) => String(value))
    : [];
  const qualifiedValues = Array.isArray(dashboardSettings.qualifiedValues)
    ? dashboardSettings.qualifiedValues.map((value) => String(value))
    : [];
  const nonQualifiedValues = Array.isArray(dashboardSettings.nonQualifiedValues)
    ? dashboardSettings.nonQualifiedValues.map((value) => String(value))
    : [];
  const reasonFieldKey = typeof dashboardSettings.reasonFieldKey === 'string'
    ? dashboardSettings.reasonFieldKey
    : null;
  const sourceFieldKey = typeof dashboardSettings.sourceFieldKey === 'string'
    ? dashboardSettings.sourceFieldKey
    : null;

  const leadWhere = buildLeadWhere(
    params.tenantId,
    params.periodStart,
    params.periodEnd,
    params.selectedPipelineIds,
  );

  const selectedCourseIds = Array.from(new Set(params.selectedReportCourseIds.map((id) => id.trim()).filter(Boolean))).slice(0, 3);

  const [callAggregate, incomesRaw, users, corporateDurationTotal, selectedReportCourses, selectedCourseIncomesRaw] = await Promise.all([
    systemPrisma.call.aggregate({
      where: {
        tenantId: params.tenantId,
        provider: AMOCRM_CALL_PROVIDER,
        startedAt: {
          gte: params.periodStart,
          lte: params.periodEnd,
        },
      },
      _count: { id: true },
      _sum: { duration: true },
    }),
    systemPrisma.income.findMany({
      where: {
        tenantId: params.tenantId,
        lifecycleStatus: 'active',
        entryDate: {
          gte: params.periodStart,
          lte: params.periodEnd,
        },
      },
      select: {
        id: true,
        type: true,
        relatedDebtIncomeId: true,
        entryDate: true,
        managerUserId: true,
        paymentAmount: true,
        coursePriceAmount: true,
        debtAmount: true,
        courseId: true,
        course: {
          select: {
            category: true,
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
    systemPrisma.user.findMany({
      where: {
        tenantId: params.tenantId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        username: true,
        roles: true,
        amocrmResponsibleUserId: true,
      },
    }),
    getCorporateCallDurationTotal({
      tenantId: params.tenantId,
      rangeStart: params.periodStart,
      rangeEnd: params.periodEnd,
    }),
    selectedCourseIds.length > 0
      ? systemPrisma.course.findMany({
          where: {
            tenantId: params.tenantId,
            id: { in: selectedCourseIds },
          },
          select: {
            id: true,
            name: true,
          },
        })
      : Promise.resolve([]),
    selectedCourseIds.length > 0
      ? systemPrisma.income.findMany({
          where: {
            tenantId: params.tenantId,
            lifecycleStatus: 'active',
            type: 'new_sale',
            courseId: { in: selectedCourseIds },
            entryDate: {
              gte: params.periodStart,
              lte: params.periodEnd,
            },
          },
          select: {
            id: true,
            type: true,
            coursePriceAmount: true,
            debtAmount: true,
            paymentAmount: true,
            courseId: true,
            tariff: {
              select: {
                name: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  // Technical sales (agreement == 1) and their repayments are bookkeeping rows, not real income.
  const technicalSaleIds = await loadTechnicalSaleIdsForRows(params.tenantId, incomesRaw);
  const incomes = excludeTechnicalRows(incomesRaw, technicalSaleIds);
  const selectedCourseIncomes = selectedCourseIncomesRaw.filter((sale) => !buildTechnicalSaleIdSet([sale]).has(sale.id));

  let newLeads = 0;
  let qualifiedLeads = 0;

  const isMappedValue = (raw: string | null | undefined, mappedValues: string[]): boolean => {
    const normalized = String(raw || '').trim().toLowerCase();

    if (!normalized || mappedValues.length === 0) {
      return false;
    }

    return mappedValues.some((item) => String(item || '').trim().toLowerCase() === normalized);
  };

  const classifyLeadOutcome = (statusIdRaw: string | null | undefined, reasonValueRaw: string | null | undefined): {
    isQualified: boolean;
    isNonQualified: boolean;
  } => {
    const statusId = String(statusIdRaw || '').trim();
    const reasonValue = String(reasonValueRaw || '').trim();
    const isQualifiedByStage = statusId ? qualifiedStageIds.includes(statusId) : false;
    const isQualified = qualifiedStageIds.length > 0
      ? isQualifiedByStage
      : isMappedValue(reasonValue, qualifiedValues);
    const isNonQualifiedByReason = nonQualifiedValues.length > 0
      ? isMappedValue(reasonValue, nonQualifiedValues)
      : false;
    const isNonQualified = isLostLeadStatus(statusId) && isNonQualifiedByReason;

    return { isQualified, isNonQualified };
  };

  const reasonMap = new Map<string, number>();
  const sourceMap = new Map<string, number>();
  const managerLeadsByAmoId = new Map<string, { leads: number; qualified: number; nonQualified: number }>();

  let usedLiveAmoLeads = false;
  let amoContext: Awaited<ReturnType<typeof getTenantAmoCRMContext>> = null;

  try {
    amoContext = await getTenantAmoCRMContext(params.tenantId);
  } catch (error: any) {
    usedLiveAmoLeads = false;
    logger.warn({
      tenantId: params.tenantId,
      error: error?.message || 'Unknown error',
    }, 'Report generation: failed to load AmoCRM context, falling back to local lead metrics');
  }
  if (amoContext) {
    try {
      const liveLeads = await amocrmService.fetchAllLeads(
        amoContext.accessToken,
        {
          pipelineIds: params.selectedPipelineIds.length > 0 ? params.selectedPipelineIds : undefined,
          createdAtFrom: params.periodStart,
          createdAtTo: params.periodEnd,
          limit: 250,
        },
        amoContext.baseUrl,
      );

      usedLiveAmoLeads = true;
      newLeads = liveLeads.length;
      for (const lead of liveLeads) {
        const statusId = String((lead as Record<string, unknown>).status_id || '').trim();
        const reasonValue = extractLeadValue(lead, reasonFieldKey);
        const { isQualified, isNonQualified } = classifyLeadOutcome(statusId, reasonValue);

        if (isQualified) {
          qualifiedLeads += 1;
        }

        if (isNonQualified) {
          const reasonBucket = reasonValue || "Sabab ko'rsatilmagan";

          reasonMap.set(reasonBucket, (reasonMap.get(reasonBucket) || 0) + 1);
        }

        const sourceValue = extractLeadValue(lead, sourceFieldKey);

        if (sourceValue) {
          sourceMap.set(sourceValue, (sourceMap.get(sourceValue) || 0) + 1);
        }

        const responsibleUserId = String((lead as Record<string, unknown>).responsible_user_id || '').trim();

        if (!responsibleUserId) {
          continue;
        }

        const current = managerLeadsByAmoId.get(responsibleUserId) || { leads: 0, qualified: 0, nonQualified: 0 };

        current.leads += 1;
        if (isQualified) {
          current.qualified += 1;
        }
        if (isNonQualified) {
          current.nonQualified += 1;
        }
        managerLeadsByAmoId.set(responsibleUserId, current);
      }
    } catch (error: any) {
      usedLiveAmoLeads = false;
      logger.warn({
        tenantId: params.tenantId,
        error: error?.message || 'Unknown error',
      }, 'Falling back to local lead metrics for report generation');
    }
  }

  if (!usedLiveAmoLeads) {
    const [dbNewLeads, dbQualifiedLeads, leadsDetailed] = await Promise.all([
      systemPrisma.lead.count({ where: leadWhere as any }),
      qualifiedStageIds.length > 0
        ? systemPrisma.lead.count({
            where: {
              ...(leadWhere as any),
              status: { in: qualifiedStageIds },
            },
          })
        : Promise.resolve(0),
      systemPrisma.lead.findMany({
        where: leadWhere as any,
        select: {
          status: true,
          responsibleUserId: true,
          metadata: true,
        },
        take: 10000,
      }),
    ]);

    newLeads = dbNewLeads;
    qualifiedLeads = dbQualifiedLeads;

    for (const lead of leadsDetailed) {
      const reasonValue = extractLeadValue(lead.metadata, reasonFieldKey);
      const statusId = lead.status ? String(lead.status) : '';
      const { isQualified, isNonQualified } = classifyLeadOutcome(statusId, reasonValue);

      if (isNonQualified) {
        const reasonBucket = reasonValue || "Sabab ko'rsatilmagan";

        reasonMap.set(reasonBucket, (reasonMap.get(reasonBucket) || 0) + 1);
      }

      const sourceValue = extractLeadValue(lead.metadata, sourceFieldKey);

      if (sourceValue) {
        sourceMap.set(sourceValue, (sourceMap.get(sourceValue) || 0) + 1);
      }

      const responsibleUserId = String(lead.responsibleUserId || '').trim();

      if (!responsibleUserId) {
        continue;
      }
      const current = managerLeadsByAmoId.get(responsibleUserId) || { leads: 0, qualified: 0, nonQualified: 0 };

      current.leads += 1;
      if (isQualified) {
        current.qualified += 1;
      }
      if (isNonQualified) {
        current.nonQualified += 1;
      }
      managerLeadsByAmoId.set(responsibleUserId, current);
    }
  }

  let incomeTotal = 0;
  let newSalesCount = 0;
  let agreementTotal = 0;
  let newSalesIncomeTotal = 0;
  let debtRepaymentIncomeTotal = 0;

  let onlineSalesCount = 0;
  let offlineSalesCount = 0;
  let intensiveSalesCount = 0;
  let onlineAgreementTotal = 0;
  let offlineAgreementTotal = 0;
  let intensiveAgreementTotal = 0;
  const managerSalesByUserId = new Map<string, { sales: number; agreementAmount: number; incomeAmount: number }>();
  const selectedCourseIdSet = new Set(selectedReportCourses.map((course) => course.id));
  const selectedCourseStats = new Map<string, { salesCount: number; tariffCounts: Map<string, number> }>();

  for (const course of selectedReportCourses) {
    selectedCourseStats.set(course.id, { salesCount: 0, tariffCounts: new Map<string, number>() });
  }
  for (const income of selectedCourseIncomes) {
    if (!income.courseId || !selectedCourseIdSet.has(income.courseId)) {
      continue;
    }
    const courseStats = selectedCourseStats.get(income.courseId) || { salesCount: 0, tariffCounts: new Map<string, number>() };
    const tariffName = String(income.tariff?.name || "Tarif yo'q").trim() || "Tarif yo'q";

    courseStats.salesCount += 1;
    courseStats.tariffCounts.set(tariffName, (courseStats.tariffCounts.get(tariffName) || 0) + 1);
    selectedCourseStats.set(income.courseId, courseStats);
  }

  for (const income of incomes) {
    const paymentAmount = Number(income.paymentAmount || 0);

    incomeTotal += paymentAmount;

    // "Yangi tushum" = first payments of new sales; every repayment is "qarzdorlik tushumi".
    // Same definition as the Telegram group summary.
    if (income.type === 'new_sale') {
      newSalesIncomeTotal += paymentAmount;
    } else {
      debtRepaymentIncomeTotal += paymentAmount;
    }

    const managerStats = managerSalesByUserId.get(income.managerUserId) || { sales: 0, agreementAmount: 0, incomeAmount: 0 };

    managerStats.incomeAmount += paymentAmount;

    if (income.type !== 'new_sale') {
      managerSalesByUserId.set(income.managerUserId, managerStats);
      continue;
    }

    newSalesCount += 1;
    const agreementAmount = resolveSaleAgreementAmount(income);

    agreementTotal += agreementAmount;
    managerStats.sales += 1;
    managerStats.agreementAmount += agreementAmount;
    managerSalesByUserId.set(income.managerUserId, managerStats);

    const category = classifyIncomeCategory(income.course);

    if (category === 'online') {
      onlineSalesCount += 1;
      onlineAgreementTotal += agreementAmount;
    } else if (category === 'offline') {
      offlineSalesCount += 1;
      offlineAgreementTotal += agreementAmount;
    } else if (category === 'intensive') {
      intensiveSalesCount += 1;
      intensiveAgreementTotal += agreementAmount;
    }

  }

  const usersByAmoId = new Map<string, { id: string; name: string; group: ManagerGroup | null }>();
  const usersById = new Map<string, { id: string; name: string; group: ManagerGroup | null }>();

  for (const user of users) {
    const displayName = (user.name || user.username || user.id).trim();
    const group = classifyManagerGroup(user.roles);

    usersById.set(user.id, { id: user.id, name: displayName, group });
    if (user.amocrmResponsibleUserId) {
      usersByAmoId.set(String(user.amocrmResponsibleUserId), { id: user.id, name: displayName, group });
    }
  }

  const managerCallDurationByUserId = new Map<string, number>();
  const managerCallCountByUserId = new Map<string, { calls: number; longCalls: number }>();
  const corporateDurationByUserId = await getCorporateCallDurationByManager({
    tenantId: params.tenantId,
    managerUserIds: users.map((user) => user.id),
    rangeStart: params.periodStart,
    rangeEnd: params.periodEnd,
  });

  const managerCalls = await systemPrisma.call.findMany({
    where: {
      ...countedCallsWhere(params.tenantId, users.map((user) => user.id)),
      startedAt: {
        gte: params.periodStart,
        lte: params.periodEnd,
      },
    },
    select: {
      managerUserId: true,
      duration: true,
    },
  });

  for (const call of managerCalls) {
    const managerUserId = call.managerUserId;

    if (!managerUserId) {
      continue;
    }
    const callDuration = Math.max(0, Number(call.duration || 0));
    const currentDuration = managerCallDurationByUserId.get(managerUserId) || 0;

    managerCallDurationByUserId.set(managerUserId, currentDuration + callDuration);

    const counts = managerCallCountByUserId.get(managerUserId) || { calls: 0, longCalls: 0 };

    counts.calls += 1;
    if (callDuration >= LONG_CALL_MIN_SECONDS) {
      counts.longCalls += 1;
    }
    managerCallCountByUserId.set(managerUserId, counts);
  }

  const emptyManagerRow = (userId: string, group: ManagerGroup | null, name: string) => ({
    userId, group, name, leads: 0, qualified: 0, nonQualified: 0, sales: 0, agreementAmount: 0, incomeAmount: 0,
  });
  const managerRowsByUserId = new Map<string, ReturnType<typeof emptyManagerRow>>();

  for (const [amoId, leadStats] of managerLeadsByAmoId.entries()) {
    const mappedUser = usersByAmoId.get(amoId);

    if (!mappedUser) {
      continue;
    }
    const existing = managerRowsByUserId.get(mappedUser.id) || emptyManagerRow(mappedUser.id, mappedUser.group, mappedUser.name);

    existing.leads += leadStats.leads;
    existing.qualified += leadStats.qualified;
    existing.nonQualified += leadStats.nonQualified;
    managerRowsByUserId.set(mappedUser.id, existing);
  }

  for (const [userId, salesStats] of managerSalesByUserId.entries()) {
    const mappedUser = usersById.get(userId);
    const existing = managerRowsByUserId.get(userId) || emptyManagerRow(userId, mappedUser?.group || null, mappedUser?.name || userId);

    existing.sales += salesStats.sales;
    existing.agreementAmount += salesStats.agreementAmount;
    existing.incomeAmount += salesStats.incomeAmount;
    managerRowsByUserId.set(userId, existing);
  }

  // Managers who only made calls (no leads or sales) still get a row.
  for (const userId of managerCallCountByUserId.keys()) {
    const mappedUser = usersById.get(userId);

    if (!mappedUser || managerRowsByUserId.has(userId)) {
      continue;
    }
    managerRowsByUserId.set(userId, emptyManagerRow(userId, mappedUser.group, mappedUser.name));
  }

  const nonQualifiedLeads = Array.from(reasonMap.values()).reduce((sum, value) => sum + value, 0);
  const qualifiedShare = newLeads > 0 ? roundPositivePercentage((qualifiedLeads / newLeads) * 100) : 0;
  const nonQualifiedShare = newLeads > 0 ? roundPositivePercentage((nonQualifiedLeads / newLeads) * 100) : 0;
  const conversionPercent = newLeads > 0 ? roundPositivePercentage((newSalesCount / newLeads) * 100) : 0;

  const reasonBreakdown = Array.from(reasonMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const sourceBreakdown = Array.from(sourceMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const managerRows = Array.from(managerRowsByUserId.values())
    .map((row) => ({
      group: row.group,
      name: row.name,
      leads: row.leads,
      qualified: row.qualified,
      nonQualified: row.nonQualified,
      sales: row.sales,
      conversion: row.leads > 0 ? roundPositivePercentage((row.sales / row.leads) * 100) : 0,
      agreementAmount: row.agreementAmount,
      incomeAmount: row.incomeAmount,
      callDurationSeconds: (managerCallDurationByUserId.get(row.userId) || 0) + (corporateDurationByUserId.get(row.userId) || 0),
      callCount: managerCallCountByUserId.get(row.userId)?.calls || 0,
      longCallCount: managerCallCountByUserId.get(row.userId)?.longCalls || 0,
    }))
    .filter((row): row is ReportManagerRow => (
      row.group !== null
      && (row.leads > 0 || row.sales > 0 || row.agreementAmount > 0 || row.incomeAmount > 0 || row.callCount > 0)
    ))
    .sort(compareManagerRows);

  const coursesById = new Map(selectedReportCourses.map((course) => [course.id, course]));
  const selectedCourseRows = selectedCourseIds
    .map((courseId) => {
      const course = coursesById.get(courseId);

      if (!course) {
        return null;
      }
      const stats = selectedCourseStats.get(courseId) || { salesCount: 0, tariffCounts: new Map<string, number>() };

      return {
        courseId,
        courseName: course.name,
        salesCount: stats.salesCount,
        tariffBreakdown: Array.from(stats.tariffCounts.entries())
          .map(([label, value]) => ({ label, value }))
          .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  return {
    newLeads,
    qualifiedLeads,
    nonQualifiedLeads,
    qualifiedShare,
    nonQualifiedShare,
    newSalesCount,
    conversionPercent,
    agreementTotal,
    incomeTotal,
    newSalesIncomeTotal,
    debtRepaymentIncomeTotal,
    onlineSalesCount,
    onlineAgreementTotal,
    offlineSalesCount,
    offlineAgreementTotal,
    intensiveSalesCount,
    intensiveAgreementTotal,
    totalCalls: Number(callAggregate._count.id || 0),
    talkDurationSeconds: Number(callAggregate._sum.duration || 0) + corporateDurationTotal,
    reasonBreakdown,
    sourceBreakdown,
    selectedCourseRows,
    managerRows,
  };
}

export async function getSelectedPipelineIdsForTenant(tenantId: string): Promise<string[]> {
  const amocrmIntegration = await systemPrisma.integration.findUnique({
    where: {
      tenantId_type: {
        tenantId,
        type: 'amocrm',
      },
    },
    select: {
      config: true,
    },
  });

  return Array.isArray((amocrmIntegration?.config as any)?.selectedPipelineIds)
    ? (amocrmIntegration?.config as any).selectedPipelineIds.map((value: unknown) => String(value))
    : [];
}
