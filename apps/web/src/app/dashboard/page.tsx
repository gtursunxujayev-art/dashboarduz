'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { trpc } from '@/lib/trpc';
import MultiSelectDropdown from '@/components/dashboard/multi-select-dropdown';
import DashboardMetricCards from '@/components/dashboard/DashboardMetricCards';
import DashboardSalarySection from '@/components/dashboard/DashboardSalarySection';
import DashboardSellerTable from '@/components/dashboard/DashboardSellerTable';

type DashboardRange = 'today' | 'week' | 'month' | 'custom';
const RANGE_OPTIONS: DashboardRange[] = ['today', 'week', 'month', 'custom'];

type DashboardCard = {
  id: string;
  title: string;
  value: string;
  subtitle: string;
  extra: string | null;
};

type DashboardCustomSalesWidget = {
  id: string;
  title: string;
  courseId: string;
  tariffId: string | null;
  subTariffId: string | null;
};

function getTashkentToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function formatAmount(value?: number | null): string {
  return `${new Intl.NumberFormat('ru-RU').format(value ?? 0)} so'm`;
}

function formatDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) {
    return '-';
  }
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${hours} soat ${minutes} daqiqa ${remainingSeconds} soniya`;
}

function formatDurationCompact(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) {
    return '-';
  }
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  return `${hours} soat ${minutes} daqiqa`;
}

function renderMetricValue(value?: number | null, suffix = ''): string {
  if (value === null || value === undefined) {
    return '-';
  }
  return `${value}${suffix}`;
}

function getRangeLabel(range: DashboardRange): string {
  if (range === 'week') {
    return 'Hafta';
  }
  if (range === 'month') {
    return 'Oy';
  }
  if (range === 'custom') {
    return 'Ixtiyoriy';
  }
  return 'Bugun';
}

function getPeriodFollowUpLabel(range: DashboardRange): string {
  if (range === 'week') {
    return 'Haftalik F/U';
  }
  if (range === 'month') {
    return 'Oylik F/U';
  }
  if (range === 'custom') {
    return 'Davr F/U';
  }
  return 'Bugungi F/U';
}

export default function DashboardPage() {
  const { user } = useAuth();
  const roles = useMemo(() => user?.roles ?? [], [user?.roles]);
  const [range, setRange] = useState<DashboardRange>('today');
  const [dateFrom, setDateFrom] = useState(getTashkentToday());
  const [dateTo, setDateTo] = useState(getTashkentToday());
  const [pipelineIds, setPipelineIds] = useState<string[]>([]);
  const { isAdmin, isAgentOnly, hasFinanceRole, showSalarySection, isFinanceOnly, isTashkiliyOnly } = useMemo(() => {
    const isAdmin = Boolean(roles.includes('Admin'));
    const isAgentOnly = Boolean(
      roles.includes('Agent')
        && !roles.includes('Admin')
        && !roles.includes('Manager')
        && !roles.includes('TeamLeader')
        && !roles.includes('Finance'),
    );
    const hasFinanceRole = Boolean(roles.includes('Finance'));
    const showSalarySection = isAgentOnly || hasFinanceRole;
    const isFinanceOnly = Boolean(
      hasFinanceRole
        && !roles.includes('Admin')
        && !roles.includes('Manager')
        && !roles.includes('TeamLeader')
        && !roles.includes('Agent'),
    );
    const isTashkiliyOnly = Boolean(
      roles.includes('Tashkiliy')
        && !roles.includes('Admin')
        && !roles.includes('Manager')
        && !roles.includes('TeamLeader')
        && !roles.includes('Agent')
        && !roles.includes('Finance'),
    );
    return { isAdmin, isAgentOnly, hasFinanceRole, showSalarySection, isFinanceOnly, isTashkiliyOnly };
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
    },
    {
      enabled: !isFinanceOnly,
      retry: 1,
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
      enabled: customSalesWidgets.length > 0,
      retry: 1,
      refetchInterval: 5 * 60 * 1000,
    },
  );
  const salarySummaryQuery = trpc.dashboard.salarySummary.useQuery(undefined, {
    enabled: showSalarySection,
    retry: 1,
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
          subtitle: 'Sotuv / lid',
          extra: null,
        },
      ]
    : [
        {
          id: 'sales-contracts',
          title: 'Sotuv shartnomasi',
          value: String(stats?.newSalesCount ?? 0),
          subtitle: formatAmount(stats?.newSalesAgreementAmount),
          extra: null,
        },
        {
          id: 'online-sales',
          title: 'Sotuv - Onlayn',
          value: String(stats?.onlineSalesCount ?? 0),
          subtitle: `Kelishuv - ${formatAmount(stats?.onlineSalesAgreementAmount)}`,
          extra: `Tushum - ${formatAmount(stats?.onlineSalesIncomeAmount)}`,
        },
        {
          id: 'offline-sales',
          title: 'Sotuv - Oflayn',
          value: String(stats?.offlineSalesCount ?? 0),
          subtitle: `Kelishuv - ${formatAmount(stats?.offlineSalesAgreementAmount)}`,
          extra: `Tushum - ${formatAmount(stats?.offlineSalesIncomeAmount)}`,
        },
        {
          id: 'intensive-sales',
          title: 'Sotuv - Intensiv',
          value: String(stats?.intensiveSalesCount ?? 0),
          subtitle: `Kelishuv - ${formatAmount(stats?.intensiveSalesAgreementAmount)}`,
          extra: `Tushum - ${formatAmount(stats?.intensiveSalesIncomeAmount)}`,
        },
        {
          id: 'total-income',
          title: 'Tushum',
          value: formatAmount(stats?.totalIncomeAmount),
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
                extra: `Davomiylik: ${formatDurationCompact(agentTalkDurationSeconds)}`,
              },
            ]
          : []),
      ], [isTashkiliyOnly, stats, isAgentOnly, agentTalkDurationSeconds]);

  const financeCards: DashboardCard[] = useMemo(() => [
    {
      id: 'finance-total-income',
      title: 'Jami tushum',
      value: formatAmount(financeTotals?.totalIncomeAmount),
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
      value: formatAmount(financeTotals?.totalDebtAmount),
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
        subtitle: isTashkiliyOnly ? `${salesCount} ta sotuv` : formatAmount(agreementAmount),
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

  const visibleWidgetSet = useMemo(() => new Set(visibleWidgetIds), [visibleWidgetIds]);
  const effectiveVisibleWidgetSet = useMemo(
    () => (layoutInitialized ? visibleWidgetSet : new Set(defaultVisibleWidgetIds)),
    [defaultVisibleWidgetIds, layoutInitialized, visibleWidgetSet],
  );
  const visibleDashboardCards = useMemo(
    () => allDashboardCards.filter((card) => effectiveVisibleWidgetSet.has(card.id)),
    [allDashboardCards, effectiveVisibleWidgetSet],
  );

  const widgetCourses = useMemo(
    () => widgetCatalogQuery.data?.courses ?? [],
    [widgetCatalogQuery.data?.courses],
  );
  const selectedWidgetCourse = useMemo(
    () => widgetCourses.find((course: any) => course.id === newWidgetCourseId) || null,
    [newWidgetCourseId, widgetCourses],
  );
  const selectedWidgetTariff = useMemo(
    () => selectedWidgetCourse?.tariffs.find((tariff: any) => tariff.id === newWidgetTariffId) || null,
    [newWidgetTariffId, selectedWidgetCourse],
  );
  const availableSubTariffs = useMemo(() => {
    if (!selectedWidgetCourse) {
      return [];
    }
    if (selectedWidgetTariff) {
      return selectedWidgetTariff.subTariffs || [];
    }
    const subTariffById = new Map<string, { id: string; name: string }>();
    for (const tariff of selectedWidgetCourse.tariffs || []) {
      for (const subTariff of tariff.subTariffs || []) {
        if (!subTariffById.has(subTariff.id)) {
          subTariffById.set(subTariff.id, subTariff);
        }
      }
    }
    return Array.from(subTariffById.values());
  }, [selectedWidgetCourse, selectedWidgetTariff]);

  const toggleWidgetVisibility = (widgetId: string) => {
    setVisibleWidgetIds((previous) => (
      previous.includes(widgetId)
        ? previous.filter((current) => current !== widgetId)
        : [...previous, widgetId]
    ));
  };

  const restoreLayoutFromServer = () => {
    const savedLayout = dashboardLayoutQuery.data;
    setCustomSalesWidgets(savedLayout?.customSalesWidgets || []);
    setVisibleWidgetIds(savedLayout?.visibleWidgetIds || []);
    setIsEditMode(false);
  };

  const addCustomSalesWidget = () => {
    if (!selectedWidgetCourse) {
      return;
    }

    const title = newWidgetTitle.trim() || [
      selectedWidgetCourse.name,
      selectedWidgetTariff?.name,
      availableSubTariffs.find((subTariff: any) => subTariff.id === newWidgetSubTariffId)?.name,
    ].filter(Boolean).join(' / ');
    if (!title) {
      return;
    }

    const widgetId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `widget_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const nextWidget: DashboardCustomSalesWidget = {
      id: widgetId,
      title,
      courseId: selectedWidgetCourse.id,
      tariffId: selectedWidgetTariff?.id || null,
      subTariffId: newWidgetSubTariffId || null,
    };

    setCustomSalesWidgets((previous) => [...previous, nextWidget]);
    setVisibleWidgetIds((previous) => Array.from(new Set([...previous, `custom:${widgetId}`])));
    setNewWidgetTitle('');
    setNewWidgetTariffId('');
    setNewWidgetSubTariffId('');
  };

  const removeCustomSalesWidget = (widgetId: string) => {
    setCustomSalesWidgets((previous) => previous.filter((widget) => widget.id !== widgetId));
    setVisibleWidgetIds((previous) => previous.filter((item) => item !== `custom:${widgetId}`));
  };

  const saveDashboardLayout = async () => {
    await saveDashboardLayoutMutation.mutateAsync({
      visibleWidgetIds,
      customSalesWidgets,
    });
    await dashboardLayoutQuery.refetch();
    setIsEditMode(false);
  };
  const salarySection = (
    <DashboardSalarySection
      showSalarySection={showSalarySection}
      isLoading={salarySummaryQuery.isLoading}
      error={salarySummaryQuery.error}
      isAgentOnly={isAgentOnly}
      salaryCurrentUser={salaryCurrentUser}
      salaryByAgent={salaryByAgent}
      salaryTotals={salaryTotals}
      salaryModeLabel={salaryModeLabel}
      formatAmount={formatAmount}
    />
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">Boshqaruv kartalarini moslashtirish</div>
        <button
          type="button"
          onClick={() => setIsEditMode((prev) => !prev)}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
            isEditMode
              ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          {isEditMode ? 'Tahrirlashni yopish' : 'Tahrirlash'}
        </button>
      </div>

      {isEditMode && (
        <div className="rounded-lg bg-white shadow">
          <div className="space-y-4 px-4 py-4 sm:px-5">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Kartalarni ko'rsatish/yashirish</h3>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {allDashboardCards.map((card) => (
                  <label key={`toggle-${card.id}`} className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={effectiveVisibleWidgetSet.has(card.id)}
                      onChange={() => toggleWidgetVisibility(card.id)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-gray-800">{card.title}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-gray-200 p-3">
              <h4 className="text-sm font-semibold text-gray-900">Maxsus sotuv kartasi qo'shish</h4>
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                <input
                  type="text"
                  value={newWidgetTitle}
                  onChange={(event) => setNewWidgetTitle(event.target.value)}
                  placeholder="Karta nomi (ixtiyoriy)"
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
                <select
                  value={newWidgetCourseId}
                  onChange={(event) => {
                    setNewWidgetCourseId(event.target.value);
                    setNewWidgetTariffId('');
                    setNewWidgetSubTariffId('');
                  }}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Kurs tanlang</option>
                  {widgetCourses.map((course: any) => (
                    <option key={course.id} value={course.id}>{course.name}</option>
                  ))}
                </select>
                <select
                  value={newWidgetTariffId}
                  onChange={(event) => {
                    setNewWidgetTariffId(event.target.value);
                    setNewWidgetSubTariffId('');
                  }}
                  disabled={!selectedWidgetCourse}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                >
                  <option value="">Barcha tariflar</option>
                  {(selectedWidgetCourse?.tariffs || []).map((tariff: any) => (
                    <option key={tariff.id} value={tariff.id}>{tariff.name}</option>
                  ))}
                </select>
                <select
                  value={newWidgetSubTariffId}
                  onChange={(event) => setNewWidgetSubTariffId(event.target.value)}
                  disabled={!selectedWidgetCourse}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                >
                  <option value="">Barcha subtariflar</option>
                  {availableSubTariffs.map((subTariff: any) => (
                    <option key={subTariff.id} value={subTariff.id}>{subTariff.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addCustomSalesWidget}
                  disabled={!newWidgetCourseId}
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  Qo'shish
                </button>
              </div>

              {customSalesWidgets.length > 0 && (
                <div className="mt-3 space-y-2">
                  {customSalesWidgets.map((widget) => {
                    const widgetId = `custom:${widget.id}`;
                    return (
                      <div key={widget.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2">
                        <label className="flex items-center gap-2 text-sm text-gray-800">
                          <input
                            type="checkbox"
                            checked={effectiveVisibleWidgetSet.has(widgetId)}
                            onChange={() => toggleWidgetVisibility(widgetId)}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>{widget.title}</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => removeCustomSalesWidget(widget.id)}
                          className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                        >
                          O'chirish
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => saveDashboardLayout().catch(() => null)}
                disabled={saveDashboardLayoutMutation.isPending}
                className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-300"
              >
                {saveDashboardLayoutMutation.isPending ? 'Saqlanmoqda...' : 'Saqlash'}
              </button>
              <button
                type="button"
                onClick={restoreLayoutFromServer}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Bekor qilish
              </button>
              {saveDashboardLayoutMutation.error && (
                <p className="text-sm text-red-600">{saveDashboardLayoutMutation.error.message}</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg bg-white shadow">
        <div className="px-3 py-2 sm:px-5 sm:py-4">
          <div className="space-y-2">
            {rangeLoadVisible && (
              <div className="overflow-x-auto">
                <div
                  className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2"
                  style={rangeTabsWidth ? { width: `${rangeTabsWidth}px` } : undefined}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[11px] font-medium text-blue-700 sm:text-xs">
                      {activeRangeQueryFetching
                        ? `Yuklanmoqda: ${rangeLoadProgress}%`
                        : 'Yangilandi'}
                    </p>
                    {activeRangeQueryFetching && (
                      <p className="text-[11px] text-blue-600 sm:text-xs">
                        Taxminan {estimatedRemainingSeconds} soniya
                      </p>
                    )}
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                    <div
                      className="h-full rounded-full bg-blue-600 transition-[width] duration-200 ease-out"
                      style={{ width: `${Math.max(0, Math.min(100, rangeLoadProgress))}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <div ref={rangeTabsRef} className="inline-flex min-w-max rounded-md shadow-sm">
                {RANGE_OPTIONS.map((option, index) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setRange(option)}
                    className={`border border-gray-300 px-2.5 py-1 text-xs font-medium sm:px-3 sm:py-1.5 sm:text-sm ${
                      range === option ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                    } ${index === 0 ? 'rounded-l-md' : ''} ${
                      index === RANGE_OPTIONS.length - 1 ? 'rounded-r-md' : ''
                    } ${index !== 0 ? 'border-l-0' : ''}`}
                  >
                    {getRangeLabel(option)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-[170px_170px_1fr]">
              <input
                type="date"
                value={dateFrom}
                disabled={range !== 'custom'}
                onChange={(event) => setDateFrom(event.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 sm:px-3 sm:py-1.5 sm:text-sm"
              />
              <input
                type="date"
                value={dateTo}
                disabled={range !== 'custom'}
                onChange={(event) => setDateTo(event.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 sm:px-3 sm:py-1.5 sm:text-sm"
              />

              {!isFinanceOnly && isAdmin && (
                <MultiSelectDropdown
                  label="Pipeline filtri"
                  options={pipelineOptions}
                  selectedIds={pipelineIds}
                  onChange={setPipelineIds}
                  placeholder="Pipeline tanlang"
                  disabled={amoPipelinesQuery.isLoading}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex items-center">
            <div className="flex-shrink-0 rounded-md bg-gray-100 p-2">
              <svg className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="ml-4">
                <h3 className="text-base font-medium leading-6 text-gray-900">
                Xush kelibsiz, {user?.email?.split('@')[0] || user?.phone || 'Foydalanuvchi'}!
              </h3>
              <p className="mt-0.5 text-sm text-gray-500">
                {isFinanceOnly
                  ? "Moliya panelida tanlangan davr bo'yicha tushum, qarzdorlar va kurs kesimidagi tushum ko'rinadi."
                  : "Barcha bo'limlar tepadagi bitta filtr bilan ishlaydi."}
              </p>
            </div>
          </div>
        </div>
      </div>

      {isFinanceOnly ? (
        <div className="space-y-6">
          {financeSummaryQuery.error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {financeSummaryQuery.error.message || 'Moliya paneli ma\'lumotlarini yuklashda xatolik.'}
            </div>
          )}

          <DashboardMetricCards cards={visibleDashboardCards} columns={5} />

          {salarySection}

          <div className="rounded-lg bg-white shadow">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="mb-4 text-lg font-medium leading-6 text-gray-900">Kurslar bo'yicha tushum</h3>
              {financeSummaryQuery.isLoading ? (
                <p className="text-sm text-gray-600">Yuklanmoqda...</p>
              ) : incomeByCourse.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kurs</th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Sotuvlar</th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Tushum</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {incomeByCourse.map((row: any) => (
                        <tr key={row.courseName}>
                          <td className="px-3 py-2 text-sm text-gray-900">{row.courseName}</td>
                          <td className="px-3 py-2 text-sm text-gray-700">{row.count}</td>
                          <td className="px-3 py-2 text-sm text-gray-700">{formatAmount(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-600">Tanlangan davr uchun tushum ma'lumoti topilmadi.</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <DashboardMetricCards cards={visibleDashboardCards} columns={3} />

          {salarySection}

          <DashboardSellerTable
            isLoading={summaryQuery.isLoading}
            sellerPerformance={sellerPerformance}
            isTashkiliyOnly={isTashkiliyOnly}
            range={range}
            formatAmount={formatAmount}
            formatDuration={formatDuration}
            renderMetricValue={renderMetricValue}
            getPeriodFollowUpLabel={getPeriodFollowUpLabel}
          />
        </>
      )}
    </div>
  );
}
