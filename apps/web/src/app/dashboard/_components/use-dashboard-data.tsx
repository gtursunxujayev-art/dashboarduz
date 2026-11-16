'use client';

import { useAuth } from '@/contexts/auth-context';
import { useDashboardAiPageContext } from '@/contexts/dashboard-ai-context';
import { getTashkentToday } from '@/lib/date-range';
import { formatDurationHoursMinutes, formatSom } from '@/lib/format';
import { trpc } from '@/lib/trpc';
import type { ReportRangePreset as DashboardRange } from '@dashboarduz/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AGENT_ROLES, type DashboardCard, type DashboardCustomSalesWidget } from './dashboard-helpers';

export function useDashboardData() {
  const { user } = useAuth();
  const roles = useMemo(() => user?.roles ?? [], [user?.roles]);
  const [range, setRange] = useState<DashboardRange>('today');
  const [dateFrom, setDateFrom] = useState(getTashkentToday());
  const [dateTo, setDateTo] = useState(getTashkentToday());
  const [pipelineIds, setPipelineIds] = useState<string[]>([]);
  const [summaryRefreshKey, setSummaryRefreshKey] = useState(0);
  const { isAdmin, isAgentOnly, isTeamLeaderOnly, hasFinanceRole, showSalarySection, isFinanceOnly, isTashkiliyOnly } = useMemo(() => {
    const isAdmin = Boolean(roles.includes('Admin'));
    const hasAgentLikeRole = roles.some((role) => AGENT_ROLES.has(role));
    const isAgentOnly = Boolean(
      hasAgentLikeRole
        && !roles.includes('Admin')
        && !roles.includes('Manager')
        && !roles.includes('TeamLeader')
        && !roles.includes('Finance'),
    );
    const hasFinanceRole = Boolean(roles.includes('Finance'));
    const isTeamLeaderOnly = Boolean(
      roles.includes('TeamLeader')
        && !roles.includes('Admin')
        && !roles.includes('Manager')
        && !hasAgentLikeRole
        && !roles.includes('Finance'),
    );
    const showSalarySection = isAgentOnly || isTeamLeaderOnly || hasFinanceRole;
    const isFinanceOnly = Boolean(
      hasFinanceRole
        && !roles.includes('Admin')
        && !roles.includes('Manager')
        && !roles.includes('TeamLeader')
        && !hasAgentLikeRole,
    );
    const isTashkiliyOnly = Boolean(
      roles.includes('Tashkiliy')
        && !roles.includes('Admin')
        && !roles.includes('Manager')
        && !roles.includes('TeamLeader')
        && !hasAgentLikeRole
        && !roles.includes('Finance'),
    );
    return { isAdmin, isAgentOnly, isTeamLeaderOnly, hasFinanceRole, showSalarySection, isFinanceOnly, isTashkiliyOnly };
  }, [roles]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [layoutInitialized, setLayoutInitialized] = useState(false);
  const [visibleWidgetIds, setVisibleWidgetIds] = useState<string[]>([]);
  const [customSalesWidgets, setCustomSalesWidgets] = useState<DashboardCustomSalesWidget[]>([]);
  const [newWidgetTitle, setNewWidgetTitle] = useState('');
  const [newWidgetCourseId, setNewWidgetCourseId] = useState('');
  const [newWidgetTariffId, setNewWidgetTariffId] = useState('');
  const [newWidgetSubTariffId, setNewWidgetSubTariffId] = useState('');
  const amoPipelinesQuery = trpc.integrations.getAmoCRMPipelines.useQuery(undefined, {
    retry: false,
    enabled: isAdmin && !isFinanceOnly,
  });
  const dashboardLayoutQuery = trpc.dashboard.getUserLayout.useQuery(undefined, {
    retry: 1,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const saveDashboardLayoutMutation = trpc.dashboard.saveUserLayout.useMutation();
  const widgetCatalogQuery = trpc.dashboard.widgetCatalogOptions.useQuery(undefined, {
    enabled: isEditMode,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const pipelineOptions = useMemo(() => {
    const pipelines = amoPipelinesQuery.data?.pipelines || [];
    return pipelines.map((pipeline: any) => ({
      id: pipeline.id,
      label: pipeline.name,
    }));
  }, [amoPipelinesQuery.data]);
  useEffect(() => {
    if (!amoPipelinesQuery.data || !isAdmin || isFinanceOnly) {
      return;
    }

    if (amoPipelinesQuery.data.hasExplicitSelection) {
      setPipelineIds(amoPipelinesQuery.data.selectedPipelineIds);
      return;
    }

    setPipelineIds((amoPipelinesQuery.data.pipelines || []).map((pipeline: any) => pipeline.id));
  }, [amoPipelinesQuery.data, isAdmin, isFinanceOnly]);
  const summaryQuery = trpc.dashboard.summary.useQuery(
    {
      range,
      pipelineIds: isAdmin ? pipelineIds : undefined,
      dateFrom: range === 'custom' ? dateFrom : undefined,
      dateTo: range === 'custom' ? dateTo : undefined,
      refreshKey: summaryRefreshKey || undefined,
    },
    {
      enabled: !isFinanceOnly,
      retry: 1,
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      refetchInterval: 5 * 60 * 1000,
    },
  );
  const financeSummaryQuery = trpc.dashboard.financeSummary.useQuery(
    {
      range,
      dateFrom: range === 'custom' ? dateFrom : undefined,
      dateTo: range === 'custom' ? dateTo : undefined,
    },
    {
      enabled: isFinanceOnly,
      retry: 1,
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      refetchInterval: 5 * 60 * 1000,
    },
  );
  const customSalesWidgetsQuery = trpc.dashboard.customSalesWidgets.useQuery(
    {
      range,
      dateFrom: range === 'custom' ? dateFrom : undefined,
      dateTo: range === 'custom' ? dateTo : undefined,
      widgets: customSalesWidgets.map((widget) => ({
        id: widget.id,
        courseId: widget.courseId,
        tariffId: widget.tariffId,
        subTariffId: widget.subTariffId,
      })),
    },
    {
      enabled: customSalesWidgets.length > 0 && summaryQuery.isSuccess,
      retry: 1,
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      refetchInterval: 5 * 60 * 1000,
    },
  );
  const salarySummaryQuery = trpc.dashboard.salarySummary.useQuery(undefined, {
    enabled: showSalarySection && (isFinanceOnly ? financeSummaryQuery.isSuccess : summaryQuery.isSuccess),
    retry: 1,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    refetchInterval: 5 * 60 * 1000,
  });
  const [rangeLoadProgress, setRangeLoadProgress] = useState(0);
  const [rangeLoadElapsedMs, setRangeLoadElapsedMs] = useState(0);
  const [rangeLoadVisible, setRangeLoadVisible] = useState(false);
  const [rangeLoadPredictedMs, setRangeLoadPredictedMs] = useState(0);
  const [rangeDurationByKey, setRangeDurationByKey] = useState<Record<string, number>>({});
  const rangeLoadStartedAtRef = useRef<number | null>(null);
  const rangeTabsRef = useRef<HTMLDivElement | null>(null);
  const [rangeTabsWidth, setRangeTabsWidth] = useState<number | null>(null);
  const activeRangeQueryFetching = isFinanceOnly ? financeSummaryQuery.isFetching : summaryQuery.isFetching;
  const defaultExpectedLoadMs = useMemo(() => {
    if (range === 'today') return 2200;
    if (range === 'week') return 3400;
    if (range === 'month') return 7000;
    const from = new Date(`${dateFrom}T00:00:00`);
    const to = new Date(`${dateTo}T23:59:59`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return 5000;
    }
    const dayDiff = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
    return Math.min(12000, Math.max(3200, dayDiff * 190));
  }, [range, dateFrom, dateTo]);
  const rangeLoadKey = useMemo(() => {
    if (range !== 'custom') {
      return range;
    }
    const from = new Date(`${dateFrom}T00:00:00`);
    const to = new Date(`${dateTo}T23:59:59`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return 'custom';
    }
    const dayDiff = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
    return `custom:${Math.min(120, dayDiff)}`;
  }, [range, dateFrom, dateTo]);
  const expectedLoadMs = rangeDurationByKey[rangeLoadKey] ?? defaultExpectedLoadMs;
  useEffect(() => {
    const node = rangeTabsRef.current;
    if (!node) {
      return;
    }

    const updateWidth = () => {
      const measured = Math.round(node.getBoundingClientRect().width);
      if (Number.isFinite(measured) && measured > 0) {
        setRangeTabsWidth(measured);
      }
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    window.addEventListener('resize', updateWidth);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, []);
  useEffect(() => {
    if (activeRangeQueryFetching) {
      setRangeLoadVisible(true);
      const startedAt = rangeLoadStartedAtRef.current ?? Date.now();
      rangeLoadStartedAtRef.current = startedAt;
      setRangeLoadPredictedMs(expectedLoadMs);

      const interval = window.setInterval(() => {
        const elapsed = Date.now() - startedAt;
        setRangeLoadElapsedMs(elapsed);
        const predicted = Math.max(expectedLoadMs, elapsed + 900);
        setRangeLoadPredictedMs(predicted);
        const linearPercent = Math.min(99, Math.round((elapsed / predicted) * 100));
        setRangeLoadProgress(Math.max(0, linearPercent));
      }, 140);

      return () => window.clearInterval(interval);
    }

    const startedAt = rangeLoadStartedAtRef.current;
    if (startedAt) {
      const actualElapsed = Date.now() - startedAt;
      setRangeDurationByKey((previous) => {
        const previousEstimate = previous[rangeLoadKey];
        const nextEstimate = previousEstimate
          ? Math.round(previousEstimate * 0.7 + actualElapsed * 0.3)
          : actualElapsed;
        return {
          ...previous,
          [rangeLoadKey]: Math.max(900, Math.min(30_000, nextEstimate)),
        };
      });
    }
    rangeLoadStartedAtRef.current = null;

    setRangeLoadProgress(100);
    const doneTimer = window.setTimeout(() => {
      setRangeLoadVisible(false);
      setRangeLoadProgress(0);
      setRangeLoadElapsedMs(0);
      setRangeLoadPredictedMs(0);
    }, 320);

    return () => window.clearTimeout(doneTimer);
  }, [activeRangeQueryFetching, expectedLoadMs, rangeLoadKey]);
  const estimatedRemainingSeconds = Math.max(
    1,
    Math.ceil(Math.max(0, rangeLoadPredictedMs - rangeLoadElapsedMs) / 1000),
  );
  const stats = summaryQuery.data?.summary;
  const sellerPerformance = useMemo(
    () => summaryQuery.data?.sellerPerformance ?? [],
    [summaryQuery.data?.sellerPerformance],
  );
  const financeTotals = financeSummaryQuery.data?.totals;
  const incomeByCourse = financeSummaryQuery.data?.incomeByCourse || [];
  const salaryByAgent = salarySummaryQuery.data?.byAgent || [];
  const salaryCurrentUser = salarySummaryQuery.data?.currentUser;
  const salaryTotals = salarySummaryQuery.data?.totals;
  const salaryModeLabel = salarySummaryQuery.data?.bonusMode === 'on_debt_closed'
    ? "Bonus rejimi: Sotuv yopilganda (qarz 0 bo'lganda)"
    : "Bonus rejimi: Tushum (har bir to'lovdan)";
  const formatPercent = (value?: number) => `${(value ?? 0).toFixed(1)}%`;
  const agentTalkDurationSeconds = useMemo(() => {
    if (!isAgentOnly) {
      return null;
    }

    return sellerPerformance.reduce((sum: number, seller: any) => {
      const seconds = typeof seller?.talkedSeconds === 'number' ? seller.talkedSeconds : 0;
      return sum + Math.max(0, seconds);
    }, 0);
  }, [isAgentOnly, sellerPerformance]);
  const aiPageContext = useMemo(() => ({
    pageKey: '/dashboard',
    rangeMode: range,
    dateFrom: range === 'custom' ? dateFrom : undefined,
    dateTo: range === 'custom' ? dateTo : undefined,
    filters: {
      pipelineIds,
      isFinanceOnly,
    },
    metrics: {
      newSalesCount: stats?.newSalesCount ?? 0,
      newSalesAgreementAmount: stats?.newSalesAgreementAmount ?? 0,
      totalIncomeAmount: stats?.totalIncomeAmount ?? financeTotals?.totalIncomeAmount ?? 0,
      totalLeads: stats?.totalLeads ?? 0,
      conversionPercent: stats?.conversionPercent ?? 0,
      qualifiedLeads: stats?.qualifiedLeads ?? 0,
      nonQualifiedLeads: stats?.nonQualifiedLeads ?? 0,
      followUpCount: stats?.followUpCount ?? 0,
      stageChangeCount: stats?.stageChangeCount ?? 0,
      sellerCount: sellerPerformance.length,
      salaryTotal: salaryTotals?.salaryAfterAttendance ?? 0,
    },
  }), [
    range,
    dateFrom,
    dateTo,
    pipelineIds,
    isFinanceOnly,
    stats,
    financeTotals?.totalIncomeAmount,
    sellerPerformance.length,
    salaryTotals?.salaryAfterAttendance,
  ]);
  useDashboardAiPageContext(aiPageContext);
  const metricCards: DashboardCard[] = useMemo(() => isTashkiliyOnly
    ? [
        {
          id: 'new-sales',
          title: 'Yangi sotuvlar',
          value: String(stats?.newSalesCount ?? 0),
          subtitle: "Tanlangan davr bo'yicha",
          extra: null,
        },
        {
          id: 'online-sales',
          title: 'Sotuv - Onlayn',
          value: String(stats?.onlineSalesCount ?? 0),
          subtitle: 'Soni',
          extra: null,
        },
        {
          id: 'offline-sales',
          title: 'Sotuv - Oflayn',
          value: String(stats?.offlineSalesCount ?? 0),
          subtitle: 'Soni',
          extra: null,
        },
        {
          id: 'intensive-sales',
          title: 'Sotuv - Intensiv',
          value: String(stats?.intensiveSalesCount ?? 0),
          subtitle: 'Soni',
          extra: null,
        },
        {
          id: 'all-leads',
          title: 'Yangi lidlar',
          value: String(stats?.totalLeads ?? 0),
          subtitle: "Tanlangan davr bo'yicha",
          extra: null,
        },
        {
          id: 'qualified-leads',
          title: 'Sifatli lidlar',
          value: String(stats?.qualifiedLeads ?? 0),
          subtitle: `${formatPercent(stats?.qualifiedLeadSharePercent)} ulush`,
          extra: null,
        },
        {
          id: 'non-qualified-leads',
          title: 'Sifatsiz lidlar',
          value: String(stats?.nonQualifiedLeads ?? 0),
          subtitle: `${formatPercent(stats?.nonQualifiedLeadSharePercent)} ulush`,
          extra: null,
        },
        {
          id: 'conversion',
          title: 'Konversiya',
          value: `${(stats?.conversionPercent ?? 0).toFixed(1)}%`,
          // Leads follow the pipeline filter; sales are not linked to a pipeline, so they are always all sales.
          subtitle: pipelineIds.length ? "Barcha sotuvlar / tanlangan pipeline lidlari" : 'Sotuv / lid',
          extra: null,
        },
      ]
    : [
        {
          id: 'sales-contracts',
          title: 'Sotuv shartnomasi',
          value: String(stats?.newSalesCount ?? 0),
          subtitle: formatSom(stats?.newSalesAgreementAmount),
          extra: null,
        },
        {
          id: 'online-sales',
          title: 'Sotuv - Onlayn',
          value: String(stats?.onlineSalesCount ?? 0),
          subtitle: `Kelishuv - ${formatSom(stats?.onlineSalesAgreementAmount)}`,
          extra: `Tushum - ${formatSom(stats?.onlineSalesIncomeAmount)}`,
        },
        {
          id: 'offline-sales',
          title: 'Sotuv - Oflayn',
          value: String(stats?.offlineSalesCount ?? 0),
          subtitle: `Kelishuv - ${formatSom(stats?.offlineSalesAgreementAmount)}`,
          extra: `Tushum - ${formatSom(stats?.offlineSalesIncomeAmount)}`,
        },
        {
          id: 'intensive-sales',
          title: 'Sotuv - Intensiv',
          value: String(stats?.intensiveSalesCount ?? 0),
          subtitle: `Kelishuv - ${formatSom(stats?.intensiveSalesAgreementAmount)}`,
          extra: `Tushum - ${formatSom(stats?.intensiveSalesIncomeAmount)}`,
        },
        {
          id: 'total-income',
          title: 'Tushum',
          value: formatSom(stats?.totalIncomeAmount),
          subtitle: "Tanlangan davr bo'yicha",
          extra: null,
        },
        {
          id: 'follow-up',
          title: 'Follow-up',
          value: String(stats?.followUpCount ?? 0),
          subtitle: 'Yakunlangan vazifalar',
          extra: null,
        },
        {
          id: 'leads-summary',
          title: 'Lidlar',
          value: `Yangi lidlar - ${String(stats?.totalLeads ?? 0)}`,
          subtitle: `Sifatli lid - ${String(stats?.qualifiedLeads ?? 0)}`,
          extra: `Sifatsiz lid - ${String(stats?.nonQualifiedLeads ?? 0)}`,
        },
        {
          id: 'notes',
          title: 'Yozuvlar',
          value: String(stats?.noteCount ?? 0),
          subtitle: "Lid bo'yicha yozuvlar",
          extra: null,
        },
        {
          id: 'stage-changes',
          title: "Bosqich o'zgarishi",
          value: String(stats?.stageChangeCount ?? 0),
          subtitle: "CRM status o'zgarishlari",
          extra: null,
        },
        ...(isAgentOnly
          ? [
              {
                id: 'agent-calls',
                title: "Qo'ng'iroqlar",
                value: `${stats?.totalCalls ?? 0} ta`,
                subtitle: "Jami qo'ng'iroq soni",
                extra: `Davomiylik: ${formatDurationHoursMinutes(agentTalkDurationSeconds)}`,
              },
            ]
          : []),
      ], [isTashkiliyOnly, stats, isAgentOnly, agentTalkDurationSeconds, pipelineIds.length]);
  const financeCards: DashboardCard[] = useMemo(() => [
    {
      id: 'finance-total-income',
      title: 'Jami tushum',
      value: formatSom(financeTotals?.totalIncomeAmount),
      subtitle: "Tanlangan davr bo'yicha",
      extra: null,
    },
    {
      id: 'finance-new-sales',
      title: 'Yangi sotuvlar',
      value: String(financeTotals?.newSalesCount ?? 0),
      subtitle: 'Sotuvlar soni',
      extra: null,
    },
    {
      id: 'finance-repayments',
      title: "Qayta to'lovlar",
      value: String(financeTotals?.repaymentCount ?? 0),
      subtitle: "To'lovlar soni",
      extra: null,
    },
    {
      id: 'finance-debtors',
      title: 'Qarzdor mijozlar',
      value: String(financeTotals?.debtorsCount ?? 0),
      subtitle: "Qarz bilan mijozlar",
      extra: null,
    },
    {
      id: 'finance-total-debt',
      title: 'Jami qarzdorlik',
      value: formatSom(financeTotals?.totalDebtAmount),
      subtitle: "Qolgan qarz summasi",
      extra: null,
    },
  ], [financeTotals]);
  const baseDashboardCards = useMemo(() => isFinanceOnly ? financeCards : metricCards, [isFinanceOnly, financeCards, metricCards]);
  const widgetMetricById = useMemo(() => {
    const entries = (customSalesWidgetsQuery.data?.widgets || []) as Array<{
      id: string;
      salesCount: number;
      agreementAmount: number;
    }>;
    return new Map(entries.map((entry) => [entry.id, entry]));
  }, [customSalesWidgetsQuery.data?.widgets]);
  const customMetricCards: DashboardCard[] = useMemo(
    () => customSalesWidgets.map((widget) => {
      const metric = widgetMetricById.get(widget.id);
      const salesCount = metric?.salesCount ?? 0;
      const agreementAmount = metric?.agreementAmount ?? 0;
      return {
        id: `custom:${widget.id}`,
        title: widget.title,
        value: String(salesCount),
        subtitle: isTashkiliyOnly ? `${salesCount} ta sotuv` : formatSom(agreementAmount),
        extra: isTashkiliyOnly ? null : `${salesCount} ta sotuv`,
      };
    }),
    [customSalesWidgets, isTashkiliyOnly, widgetMetricById],
  );
  const allDashboardCards = useMemo(
    () => [...baseDashboardCards, ...customMetricCards],
    [baseDashboardCards, customMetricCards],
  );
  const availableWidgetIds = useMemo(() => allDashboardCards.map((card) => card.id), [allDashboardCards]);
  const defaultVisibleWidgetIds = useMemo(
    () => [...baseDashboardCards.map((card) => card.id), ...customMetricCards.map((card) => card.id)],
    [baseDashboardCards, customMetricCards],
  );
  useEffect(() => {
    if (layoutInitialized || dashboardLayoutQuery.isLoading) {
      return;
    }

    const savedLayout = dashboardLayoutQuery.data;
    setCustomSalesWidgets(savedLayout?.customSalesWidgets || []);
    setVisibleWidgetIds(savedLayout?.visibleWidgetIds || []);
    setLayoutInitialized(true);
  }, [dashboardLayoutQuery.data, dashboardLayoutQuery.isLoading, layoutInitialized]);
  useEffect(() => {
    if (!layoutInitialized) {
      return;
    }

    const availableSet = new Set(availableWidgetIds);
    setVisibleWidgetIds((previous) => {
      const initial = previous.length ? previous : defaultVisibleWidgetIds;
      const normalized = Array.from(new Set(initial.filter((widgetId) => availableSet.has(widgetId))));
      const fallback = defaultVisibleWidgetIds.length ? defaultVisibleWidgetIds : availableWidgetIds;
      if (!normalized.length && fallback.length) {
        return fallback;
      }
      if (normalized.join('|') === previous.join('|')) {
        return previous;
      }
      return normalized;
    });
  }, [availableWidgetIds, defaultVisibleWidgetIds, layoutInitialized]);

  return { user, roles, range, setRange, dateFrom, setDateFrom, dateTo, setDateTo, pipelineIds, setPipelineIds, summaryRefreshKey, setSummaryRefreshKey, isAdmin, isAgentOnly, isTeamLeaderOnly, hasFinanceRole, showSalarySection, isFinanceOnly, isTashkiliyOnly, isEditMode, setIsEditMode, layoutInitialized, setLayoutInitialized, visibleWidgetIds, setVisibleWidgetIds, customSalesWidgets, setCustomSalesWidgets, newWidgetTitle, setNewWidgetTitle, newWidgetCourseId, setNewWidgetCourseId, newWidgetTariffId, setNewWidgetTariffId, newWidgetSubTariffId, setNewWidgetSubTariffId, amoPipelinesQuery, dashboardLayoutQuery, saveDashboardLayoutMutation, widgetCatalogQuery, pipelineOptions, summaryQuery, financeSummaryQuery, customSalesWidgetsQuery, salarySummaryQuery, rangeLoadProgress, setRangeLoadProgress, rangeLoadElapsedMs, setRangeLoadElapsedMs, rangeLoadVisible, setRangeLoadVisible, rangeLoadPredictedMs, setRangeLoadPredictedMs, rangeDurationByKey, setRangeDurationByKey, rangeLoadStartedAtRef, rangeTabsRef, rangeTabsWidth, setRangeTabsWidth, activeRangeQueryFetching, defaultExpectedLoadMs, rangeLoadKey, expectedLoadMs, estimatedRemainingSeconds, stats, sellerPerformance, financeTotals, incomeByCourse, salaryByAgent, salaryCurrentUser, salaryTotals, salaryModeLabel, formatPercent, agentTalkDurationSeconds, aiPageContext, metricCards, financeCards, baseDashboardCards, widgetMetricById, customMetricCards, allDashboardCards, availableWidgetIds, defaultVisibleWidgetIds };
}
