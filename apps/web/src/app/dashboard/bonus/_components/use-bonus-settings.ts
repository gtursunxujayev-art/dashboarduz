'use client';

import { useAuth } from '@/contexts/auth-context';
import { trpc } from '@/lib/trpc';
import { type SalaryBonusMode as BonusMode, normalizeSubTariffName, type PenaltyTarget, type CourseCategory as PlanCategory, type PlanBonusPeriodMode as PlanPeriodMode } from '@dashboarduz/shared';
import { useEffect, useMemo, useState } from 'react';
import { AGENT_ROLES, type AgentUserOption, type BonusPlan, type BonusRulesState, type CatalogCourse, type CategoryBonusRule, type CourseOverrideState, createDefaultBonusRulesState, createDefaultKpiThresholds, KPI_METRIC_KEYS, type KpiMetricKey, type KpiThresholdStateMap, mapRuleToState, type SubTariffOption } from './bonus-helpers';

export function useBonusSettings() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const isAdmin = Boolean(roles.includes('Admin'));
  const isManagerLike = Boolean((roles.includes('Manager') || roles.includes('TeamLeader')) && !isAdmin);
  const canView = isAdmin || isManagerLike;
  const [salaryBonusMode, setSalaryBonusMode] = useState<BonusMode>('on_income');
  const [bonusRulesState, setBonusRulesState] = useState<BonusRulesState>(() => createDefaultBonusRulesState());
  const [effectiveMonth, setEffectiveMonth] = useState(() => {
    const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  const [courseSearch, setCourseSearch] = useState('');
  const [courseOverrides, setCourseOverrides] = useState<Record<string, CourseOverrideState>>({});
  const [fixedSalaryByAgent, setFixedSalaryByAgent] = useState<Record<string, string>>({});
  const [attendancePenaltyLateMinute, setAttendancePenaltyLateMinute] = useState('0');
  const [attendancePenaltyMissingHour, setAttendancePenaltyMissingHour] = useState('0');
  const [attendancePenaltyAbsenceDay, setAttendancePenaltyAbsenceDay] = useState('0');
  const [attendancePenaltyCap, setAttendancePenaltyCap] = useState('0');
  const [attendanceLateTarget, setAttendanceLateTarget] = useState<PenaltyTarget>('kpi');
  const [attendanceMissingTarget, setAttendanceMissingTarget] = useState<PenaltyTarget>('kpi');
  const [kpiMonthlyAmount, setKpiMonthlyAmount] = useState('0');
  const [kpiMetricSlots, setKpiMetricSlots] = useState<Array<KpiMetricKey | ''>>(['', '', '', '']);
  const [kpiThresholds, setKpiThresholds] = useState<KpiThresholdStateMap>(() => createDefaultKpiThresholds());
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planName, setPlanName] = useState('');
  const [planCategory, setPlanCategory] = useState<PlanCategory>('online');
  const [planCourseId, setPlanCourseId] = useState('');
  const [planTariffId, setPlanTariffId] = useState('');
  const [planSubTariffId, setPlanSubTariffId] = useState('');
  const [planSubTariffName, setPlanSubTariffName] = useState('');
  const [planPeriodMode, setPlanPeriodMode] = useState<PlanPeriodMode>('monthly');
  const [planTargetClosedSales, setPlanTargetClosedSales] = useState('');
  const [planBonusAmount, setPlanBonusAmount] = useState('');
  const [planActive, setPlanActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSuccess, setPlanSuccess] = useState<string | null>(null);
  const salaryConfigQuery = trpc.bonus.getSalaryConfig.useQuery(undefined, {
    enabled: canView,
    retry: false,
  });
  const usersQuery = trpc.users.list.useQuery(undefined, {
    enabled: canView,
    retry: false,
  });
  const plansQuery = trpc.bonus.listPlans.useQuery(undefined, {
    enabled: canView,
    retry: false,
  });
  const catalogQuery = trpc.bonus.catalogOptions.useQuery(undefined, {
    enabled: canView,
    retry: false,
  });
  const policyEditorQuery = trpc.bonus.getPolicyEditor.useQuery({ effectiveMonth }, { enabled: canView, retry: false });
  const savePolicyVersionMutation = trpc.bonus.savePolicyVersion.useMutation();
  const updateFixedSalariesMutation = trpc.bonus.updateFixedSalaries.useMutation();
  const updateKpiSettingsMutation = trpc.bonus.updateKpiSettings.useMutation();
  const updateAttendancePenaltySettingsMutation = trpc.bonus.updateAttendancePenaltySettings.useMutation();
  const createPlan = trpc.bonus.createPlan.useMutation();
  const updatePlan = trpc.bonus.updatePlan.useMutation();
  const deletePlan = trpc.bonus.deletePlan.useMutation();
  useEffect(() => {
    if (!salaryConfigQuery.data) {
      return;
    }

    setSalaryBonusMode(salaryConfigQuery.data.bonusMode === 'on_debt_closed' ? 'on_debt_closed' : 'on_income');
    setBonusRulesState({
      online: mapRuleToState(salaryConfigQuery.data.bonusRules.online as CategoryBonusRule),
      offline: mapRuleToState(salaryConfigQuery.data.bonusRules.offline as CategoryBonusRule),
      intensive: mapRuleToState(salaryConfigQuery.data.bonusRules.intensive as CategoryBonusRule),
      additional_service: mapRuleToState(salaryConfigQuery.data.bonusRules.additional_service as CategoryBonusRule),
    });

    const fixedRows = Array.isArray(salaryConfigQuery.data.fixedSalaries)
      ? salaryConfigQuery.data.fixedSalaries
      : [];
    const nextFixed: Record<string, string> = {};
    for (const row of fixedRows as Array<Record<string, unknown>>) {
      const userId = typeof row.userId === 'string' ? row.userId : '';
      if (!userId) {
        continue;
      }
      const amount = Number(row.amount);
      nextFixed[userId] = Number.isFinite(amount) && amount > 0 ? String(Math.round(amount)) : '';
    }
    setFixedSalaryByAgent(nextFixed);

    const attendanceSettings = salaryConfigQuery.data.attendancePenaltySettings as Record<string, unknown> | undefined;
    setAttendancePenaltyLateMinute(String(Number(attendanceSettings?.lateMinutePenaltyUZS || 0)));
    setAttendancePenaltyMissingHour(String(Number(attendanceSettings?.missingHourPenaltyUZS || 0)));
    setAttendancePenaltyAbsenceDay(String(Number(attendanceSettings?.absenceDayPenaltyUZS || 0)));
    setAttendancePenaltyCap(String(Number(attendanceSettings?.monthlyPenaltyCapUZS || 0)));
    const parseTarget = (value: unknown, fallback: PenaltyTarget): PenaltyTarget =>
      value === 'fixed' || value === 'kpi' ? value : fallback;
    setAttendanceLateTarget(parseTarget(attendanceSettings?.latePenaltyTarget, 'kpi'));
    setAttendanceMissingTarget(parseTarget(attendanceSettings?.missingHourPenaltyTarget, 'kpi'));

    const rawKpi = salaryConfigQuery.data.kpiSettings as Record<string, any> | undefined;
    setKpiMonthlyAmount(String(Number(rawKpi?.monthlyBudget || 0)));
    const selectedMetrics = Array.isArray(rawKpi?.selectedMetrics)
      ? rawKpi.selectedMetrics.filter((item: unknown): item is KpiMetricKey => KPI_METRIC_KEYS.includes(item as KpiMetricKey))
      : [];
    setKpiMetricSlots([selectedMetrics[0] || '', selectedMetrics[1] || '', selectedMetrics[2] || '', selectedMetrics[3] || '']);
    const thresholdState = createDefaultKpiThresholds();
    for (const metric of KPI_METRIC_KEYS) {
      const threshold = rawKpi?.thresholds?.[metric];
      thresholdState[metric] = {
        full: String(Number(threshold?.full || 0)),
        half: String(Number(threshold?.half || 0)),
      };
    }
    setKpiThresholds(thresholdState);
  }, [salaryConfigQuery.data]);
  useEffect(() => {
    if (!policyEditorQuery.data) return;
    setSalaryBonusMode(policyEditorQuery.data.policy.bonusMode);
    setBonusRulesState({
      online: mapRuleToState(policyEditorQuery.data.policy.bonusRules.online as CategoryBonusRule),
      offline: mapRuleToState(policyEditorQuery.data.policy.bonusRules.offline as CategoryBonusRule),
      intensive: mapRuleToState(policyEditorQuery.data.policy.bonusRules.intensive as CategoryBonusRule),
      additional_service: mapRuleToState(policyEditorQuery.data.policy.bonusRules.additional_service as CategoryBonusRule),
    });
    const rawOverrides = policyEditorQuery.data.policy.courseOverrides || {};
    const next: Record<string, CourseOverrideState> = {};
    for (const course of policyEditorQuery.data.courses) {
      const override = rawOverrides[course.id];
      next[course.id] = override ? {
        enabled: true,
        fallbackPercent: String(override.fallbackPercent),
        tiers: override.tiers.map((tier) => ({
          minAmount: String(tier.minAmount),
          maxAmount: tier.maxAmount === null ? '' : String(tier.maxAmount),
          percent: String(tier.percent),
        })),
      } : {
        enabled: false,
        fallbackPercent: '0',
        tiers: [{ minAmount: '0', maxAmount: '', percent: '' }],
      };
    }
    setCourseOverrides(next);
  }, [policyEditorQuery.data]);
  const agentUsers = useMemo<AgentUserOption[]>(() => {
    const users = usersQuery.data || [];
    return users
      .filter((currentUser) => Array.isArray(currentUser.roles) && (currentUser.roles.some((role: string) => AGENT_ROLES.has(role)) || currentUser.roles.includes('TeamLeader')))
      .filter((currentUser) => currentUser.isActive !== false)
      .map((currentUser) => ({
        id: currentUser.id as string,
        label: (currentUser.name as string | null) || (currentUser.username as string | null) || currentUser.id,
      }));
  }, [usersQuery.data]);
  const selectedKpiMetrics = useMemo<KpiMetricKey[]>(() => {
    const unique = new Set<KpiMetricKey>();
    for (const metric of kpiMetricSlots) {
      if (metric) {
        unique.add(metric);
      }
    }
    return Array.from(unique);
  }, [kpiMetricSlots]);
  const plans = useMemo<BonusPlan[]>(
    () => (plansQuery.data?.plans as BonusPlan[] | undefined) || [],
    [plansQuery.data?.plans],
  );
  const catalogCourses = useMemo<CatalogCourse[]>(
    () => (catalogQuery.data?.courses as CatalogCourse[] | undefined) || [],
    [catalogQuery.data?.courses],
  );
  const policyCourses = useMemo(() => (
    (policyEditorQuery.data?.courses || []).filter((course) => course.name.toLowerCase().includes(courseSearch.trim().toLowerCase()))
  ), [policyEditorQuery.data?.courses, courseSearch]);
  const isPastPolicyMonth = Boolean(policyEditorQuery.data?.currentMonth && effectiveMonth < policyEditorQuery.data.currentMonth);
  const courseNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const course of catalogCourses) {
      map.set(course.id, course.name);
      for (const tariff of course.tariffs) {
        map.set(tariff.id, tariff.name);
        for (const subTariff of tariff.subTariffs) {
          map.set(subTariff.id, subTariff.name);
        }
      }
    }
    return map;
  }, [catalogCourses]);
  const courseOptions = useMemo(
    () => catalogCourses.filter((course) => String(course.category || '').trim().toLowerCase() === planCategory),
    [catalogCourses, planCategory],
  );
  const selectedCourse = useMemo(
    () => courseOptions.find((course) => course.id === planCourseId) || null,
    [courseOptions, planCourseId],
  );
  const tariffOptions = useMemo(
    () => selectedCourse?.tariffs || [],
    [selectedCourse],
  );
  const selectedTariff = useMemo(
    () => tariffOptions.find((tariff) => tariff.id === planTariffId) || null,
    [tariffOptions, planTariffId],
  );
  const singleTariffSubTariffOptions = useMemo<SubTariffOption[]>(
    () => (selectedTariff?.subTariffs || []).map((subTariff) => ({
      value: subTariff.id,
      label: subTariff.name,
    })),
    [selectedTariff],
  );
  const allTariffsSubTariffOptions = useMemo<SubTariffOption[]>(() => {
    if (!selectedCourse) {
      return [];
    }
    const uniqueByNormalizedName = new Map<string, string>();
    for (const tariff of selectedCourse.tariffs) {
      for (const subTariff of tariff.subTariffs) {
        const key = normalizeSubTariffName(subTariff.name);
        if (!key || uniqueByNormalizedName.has(key)) {
          continue;
        }
        uniqueByNormalizedName.set(key, subTariff.name);
      }
    }
    return Array.from(uniqueByNormalizedName.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [selectedCourse]);
  const subTariffOptions = planTariffId ? singleTariffSubTariffOptions : allTariffsSubTariffOptions;

  return { user, roles, isAdmin, isManagerLike, canView, salaryBonusMode, setSalaryBonusMode, bonusRulesState, setBonusRulesState, effectiveMonth, setEffectiveMonth, courseSearch, setCourseSearch, courseOverrides, setCourseOverrides, fixedSalaryByAgent, setFixedSalaryByAgent, attendancePenaltyLateMinute, setAttendancePenaltyLateMinute, attendancePenaltyMissingHour, setAttendancePenaltyMissingHour, attendancePenaltyAbsenceDay, setAttendancePenaltyAbsenceDay, attendancePenaltyCap, setAttendancePenaltyCap, attendanceLateTarget, setAttendanceLateTarget, attendanceMissingTarget, setAttendanceMissingTarget, kpiMonthlyAmount, setKpiMonthlyAmount, kpiMetricSlots, setKpiMetricSlots, kpiThresholds, setKpiThresholds, editingPlanId, setEditingPlanId, planName, setPlanName, planCategory, setPlanCategory, planCourseId, setPlanCourseId, planTariffId, setPlanTariffId, planSubTariffId, setPlanSubTariffId, planSubTariffName, setPlanSubTariffName, planPeriodMode, setPlanPeriodMode, planTargetClosedSales, setPlanTargetClosedSales, planBonusAmount, setPlanBonusAmount, planActive, setPlanActive, error, setError, success, setSuccess, planError, setPlanError, planSuccess, setPlanSuccess, salaryConfigQuery, usersQuery, plansQuery, catalogQuery, policyEditorQuery, savePolicyVersionMutation, updateFixedSalariesMutation, updateKpiSettingsMutation, updateAttendancePenaltySettingsMutation, createPlan, updatePlan, deletePlan, agentUsers, selectedKpiMetrics, plans, catalogCourses, policyCourses, isPastPolicyMonth, courseNameById, courseOptions, selectedCourse, tariffOptions, selectedTariff, singleTariffSubTariffOptions, allTariffsSubTariffOptions, subTariffOptions };
}
