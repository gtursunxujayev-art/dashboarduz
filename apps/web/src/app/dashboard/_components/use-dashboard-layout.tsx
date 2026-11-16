'use client';

import DashboardSalarySection from '@/components/dashboard/DashboardSalarySection';
import { formatSom } from '@/lib/format';
import { useMemo } from 'react';
import type { DashboardCustomSalesWidget } from './dashboard-helpers';
import type { useDashboardData } from './use-dashboard-data';

export function useDashboardLayout(base: ReturnType<typeof useDashboardData>) {
  const { allDashboardCards, customSalesWidgets, dashboardLayoutQuery, defaultVisibleWidgetIds, isAgentOnly, isTeamLeaderOnly, layoutInitialized, newWidgetCourseId, newWidgetSubTariffId, newWidgetTariffId, newWidgetTitle, salaryByAgent, salaryCurrentUser, salaryModeLabel, salarySummaryQuery, salaryTotals, saveDashboardLayoutMutation, setCustomSalesWidgets, setIsEditMode, setNewWidgetSubTariffId, setNewWidgetTariffId, setNewWidgetTitle, setVisibleWidgetIds, showSalarySection, visibleWidgetIds, widgetCatalogQuery } = base;

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
      isTeamLeaderView={isTeamLeaderOnly}
      salaryCurrentUser={salaryCurrentUser}
      salaryByAgent={salaryByAgent}
      salaryTotals={salaryTotals}
      salaryModeLabel={salaryModeLabel}
      formatAmount={formatSom}
    />
  );

  return { ...base, visibleWidgetSet, effectiveVisibleWidgetSet, visibleDashboardCards, widgetCourses, selectedWidgetCourse, selectedWidgetTariff, availableSubTariffs, toggleWidgetVisibility, restoreLayoutFromServer, addCustomSalesWidget, removeCustomSalesWidget, saveDashboardLayout, salarySection };
}
