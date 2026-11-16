'use client';

import { parseAmountInput } from '@/lib/format';
import { COURSE_CATEGORIES, type SalaryRuleMode as CourseBonusMode, normalizeSubTariffName, type CourseCategory as SalaryCategory } from '@dashboarduz/shared';
import { type AgentUserOption, type BonusPlan, type CategoryBonusRule, getSalaryCategoryLabel, KPI_METRIC_KEYS, KPI_METRICS, type KpiMetricKey, parsePercentInput, parsePositiveInt } from './bonus-helpers';
import type { useBonusSettings } from './use-bonus-settings';

export function useBonusActions(prev: ReturnType<typeof useBonusSettings>) {
  const { agentUsers, attendanceLateTarget, attendanceMissingTarget, attendancePenaltyAbsenceDay, attendancePenaltyCap, attendancePenaltyLateMinute, attendancePenaltyMissingHour, bonusRulesState, courseOverrides, createPlan, deletePlan, editingPlanId, effectiveMonth, fixedSalaryByAgent, isAdmin, kpiMonthlyAmount, kpiThresholds, planActive, planBonusAmount, planCategory, planCourseId, planName, planPeriodMode, planSubTariffId, planSubTariffName, planTargetClosedSales, planTariffId, plansQuery, policyEditorQuery, salaryBonusMode, salaryConfigQuery, savePolicyVersionMutation, selectedKpiMetrics, setBonusRulesState, setEditingPlanId, setError, setKpiMetricSlots, setPlanActive, setPlanBonusAmount, setPlanCategory, setPlanCourseId, setPlanError, setPlanName, setPlanPeriodMode, setPlanSubTariffId, setPlanSubTariffName, setPlanSuccess, setPlanTargetClosedSales, setPlanTariffId, setSuccess, updateAttendancePenaltySettingsMutation, updateFixedSalariesMutation, updateKpiSettingsMutation, updatePlan } = prev;

  const resetPlanForm = () => {
    setEditingPlanId(null);
    setPlanName('');
    setPlanCategory('online');
    setPlanCourseId('');
    setPlanTariffId('');
    setPlanSubTariffId('');
    setPlanSubTariffName('');
    setPlanPeriodMode('monthly');
    setPlanTargetClosedSales('');
    setPlanBonusAmount('');
    setPlanActive(true);
  };
  const validateAndBuildBonusRulesPayload = (): { bonusRules: Record<SalaryCategory, CategoryBonusRule> } | null => {
    const categories: SalaryCategory[] = [...COURSE_CATEGORIES];
    const payload = {} as Record<SalaryCategory, CategoryBonusRule>;

    for (const category of categories) {
      const currentRule = bonusRulesState[category];
      if (!currentRule) {
        setError(`${getSalaryCategoryLabel(category)} qoidasi topilmadi.`);
        return null;
      }

      if (currentRule.mode === 'simple') {
        const simplePercent = parsePercentInput(currentRule.simplePercent);
        payload[category] = {
          mode: 'simple',
          simplePercent,
          tiers: [],
        };
        continue;
      }

      const normalizedTiers = currentRule.tiers
        .map((tier) => ({
          minSales: parsePositiveInt(tier.minSales),
          maxSales: tier.maxSales.trim() ? parsePositiveInt(tier.maxSales) : null,
          percent: parsePercentInput(tier.percent),
        }))
        .filter((tier) => tier.minSales > 0 && tier.percent > 0)
        .sort((a, b) => a.minSales - b.minSales);

      if (!normalizedTiers.length) {
        setError(`${getSalaryCategoryLabel(category)} uchun kamida bitta tier kiriting.`);
        return null;
      }

      for (let index = 0; index < normalizedTiers.length; index += 1) {
        const tier = normalizedTiers[index];
        if (!tier) {
          setError(`${getSalaryCategoryLabel(category)} tierlari noto'g'ri.`);
          return null;
        }
        if (tier.maxSales !== null && tier.maxSales < tier.minSales) {
          setError(`${getSalaryCategoryLabel(category)}: diapazon oxiri boshlanishdan kichik bo'lmasligi kerak.`);
          return null;
        }
        if (tier.maxSales === null && index !== normalizedTiers.length - 1) {
          setError(`${getSalaryCategoryLabel(category)}: ochiq diapazon faqat oxirgi qatorda bo'lishi kerak.`);
          return null;
        }
        if (index > 0) {
          const prev = normalizedTiers[index - 1];
          if (!prev) {
            setError(`${getSalaryCategoryLabel(category)}: tier tartibi xato.`);
            return null;
          }
          const prevMax = prev.maxSales ?? Number.MAX_SAFE_INTEGER;
          if (tier.minSales <= prevMax) {
            setError(`${getSalaryCategoryLabel(category)}: tier diapazonlari kesishmasligi kerak.`);
            return null;
          }
          if (prev.maxSales === null) {
            setError(`${getSalaryCategoryLabel(category)}: ochiq diapazondan keyin yangi diapazon bo'lishi mumkin emas.`);
            return null;
          }
        }
      }

      payload[category] = {
        mode: 'tiered',
        simplePercent: parsePercentInput(currentRule.simplePercent),
        tiers: normalizedTiers,
      };
    }

    return { bonusRules: payload };
  };
  const handleSaveBonusRules = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isAdmin) {
      setError("Faqat admin bonus sozlamalarini o'zgartira oladi.");
      return;
    }

    const prepared = validateAndBuildBonusRulesPayload();
    if (!prepared) {
      return;
    }

    try {
      const normalizedCourseOverrides: Record<string, {
        mode: 'monthly_team_income_tiered';
        fallbackPercent: number;
        tiers: Array<{ minAmount: number; maxAmount: number | null; percent: number }>;
      }> = {};
      for (const [courseId, state] of Object.entries(courseOverrides)) {
        if (!state.enabled) continue;
        const tiers = state.tiers.map((tier) => ({
          minAmount: parseAmountInput(tier.minAmount),
          maxAmount: tier.maxAmount.trim() ? parseAmountInput(tier.maxAmount) : null,
          percent: parsePercentInput(tier.percent),
        })).sort((left, right) => left.minAmount - right.minAmount);
        if (!tiers.length || tiers.some((tier) => tier.percent <= 0)) throw new Error('Kurs bonusi uchun kamida bitta to\'liq tier kiriting.');
        if (tiers[tiers.length - 1]?.maxAmount !== null) throw new Error('Kurs bonusining oxirgi tieri ochiq bo\'lishi kerak.');
        normalizedCourseOverrides[courseId] = {
          mode: 'monthly_team_income_tiered',
          fallbackPercent: parsePercentInput(state.fallbackPercent),
          tiers,
        };
      }
      await savePolicyVersionMutation.mutateAsync({
        effectiveMonth,
        bonusMode: salaryBonusMode,
        bonusRules: prepared.bonusRules,
        courseOverrides: normalizedCourseOverrides,
      });
      await Promise.all([salaryConfigQuery.refetch(), policyEditorQuery.refetch(), plansQuery.refetch()]);
      setSuccess("Bonus qoidalari muvaffaqiyatli saqlandi.");
    } catch (saveError: any) {
      setError(saveError?.message || "Bonus qoidalarini saqlashda xatolik.");
    }
  };
  const handleSaveFixedSalaries = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isAdmin) {
      setError("Faqat admin fiks maoshni o'zgartira oladi.");
      return;
    }

    const fixedSalaries = agentUsers
      .map((agent: AgentUserOption) => ({
        userId: agent.id,
        amount: parseAmountInput(fixedSalaryByAgent[agent.id] || ''),
      }))
      .filter((row: { userId: string; amount: number }) => row.amount > 0);

    try {
      await updateFixedSalariesMutation.mutateAsync({
        fixedSalaries,
      });
      await salaryConfigQuery.refetch();
      setSuccess("Fiks maoshlar muvaffaqiyatli saqlandi.");
    } catch (saveError: any) {
      setError(saveError?.message || "Fiks maoshlarni saqlashda xatolik.");
    }
  };
  const handleSaveAttendancePenaltySettings = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isAdmin) {
      setError("Faqat admin davomat jarimalarini o'zgartira oladi.");
      return;
    }

    try {
      await updateAttendancePenaltySettingsMutation.mutateAsync({
        lateMinutePenaltyUZS: parseAmountInput(attendancePenaltyLateMinute),
        missingHourPenaltyUZS: parseAmountInput(attendancePenaltyMissingHour),
        absenceDayPenaltyUZS: parseAmountInput(attendancePenaltyAbsenceDay),
        applyToFixedSalary:
          attendanceLateTarget === 'fixed'
          || attendanceMissingTarget === 'fixed'
          || parseAmountInput(attendancePenaltyAbsenceDay) > 0,
        applyToKpi:
          attendanceLateTarget === 'kpi'
          || attendanceMissingTarget === 'kpi',
        latePenaltyTarget: attendanceLateTarget,
        missingHourPenaltyTarget: attendanceMissingTarget,
        absenceDayPenaltyTarget: 'fixed',
        monthlyPenaltyCapUZS: parseAmountInput(attendancePenaltyCap),
      });
      await salaryConfigQuery.refetch();
      setSuccess('Davomat jarima sozlamalari saqlandi.');
    } catch (saveError: any) {
      setError(saveError?.message || 'Davomat jarima sozlamalarini saqlashda xatolik.');
    }
  };
  const handleKpiMetricSlotChange = (index: number, value: string) => {
    const normalized = (value || '') as KpiMetricKey | '';
    setKpiMetricSlots((prev) => {
      const next = [...prev];
      next[index] = normalized;
      return next;
    });
  };
  const handleSaveKpiSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isAdmin) {
      setError("Faqat admin KPI sozlamalarini o'zgartira oladi.");
      return;
    }

    if (!selectedKpiMetrics.length) {
      setError("KPI uchun kamida bitta ko'rsatkich tanlang.");
      return;
    }

    const thresholds = KPI_METRIC_KEYS.reduce((acc, metric) => {
      acc[metric] = {
        full: parsePositiveInt(kpiThresholds[metric]?.full || '0'),
        half: parsePositiveInt(kpiThresholds[metric]?.half || '0'),
      };
      return acc;
    }, {} as Record<KpiMetricKey, { full: number; half: number }>);

    for (const metric of selectedKpiMetrics) {
      const threshold = thresholds[metric];
      if (!threshold || threshold.full <= 0 || threshold.half <= 0) {
        setError(`${KPI_METRICS.find((item) => item.key === metric)?.label || metric} uchun full/half qiymat kiriting.`);
        return;
      }
    }

    try {
      await updateKpiSettingsMutation.mutateAsync({
        monthlyKpiAmount: parseAmountInput(kpiMonthlyAmount),
        selectedMetrics: selectedKpiMetrics,
        thresholds,
      });
      await salaryConfigQuery.refetch();
      setSuccess('KPI sozlamalari saqlandi.');
    } catch (saveError: any) {
      setError(saveError?.message || 'KPI sozlamalarini saqlashda xatolik.');
    }
  };
  const handleSavePlan = async (event: React.FormEvent) => {
    event.preventDefault();
    setPlanError(null);
    setPlanSuccess(null);

    if (!isAdmin) {
      setPlanError("Faqat admin plan bonuslarni o'zgartira oladi.");
      return;
    }

    const targetClosedSales = parseAmountInput(planTargetClosedSales);
    const bonusAmount = parseAmountInput(planBonusAmount);
    if (!planName.trim()) {
      setPlanError('Plan nomi majburiy.');
      return;
    }
    if (targetClosedSales <= 0) {
      setPlanError("Yopilgan sotuvlar soni 0 dan katta bo'lishi kerak.");
      return;
    }
    if (bonusAmount <= 0) {
      setPlanError("Bonus summasi 0 dan katta bo'lishi kerak.");
      return;
    }

    const payload = {
      name: planName.trim(),
      isActive: planActive,
      periodMode: planPeriodMode,
      courseCategory: planCategory,
      courseId: planCourseId || null,
      tariffId: planTariffId || null,
      subTariffId: planTariffId ? (planSubTariffId || null) : null,
      subTariffName: !planTariffId && planSubTariffName ? planSubTariffName : null,
      targetClosedSales,
      bonusAmount,
    } as const;

    try {
      if (editingPlanId) {
        await updatePlan.mutateAsync({
          id: editingPlanId,
          ...payload,
        });
        setPlanSuccess('Plan bonus yangilandi.');
      } else {
        await createPlan.mutateAsync(payload);
        setPlanSuccess("Yangi plan bonus qo'shildi.");
      }
      await plansQuery.refetch();
      resetPlanForm();
    } catch (mutationError: any) {
      setPlanError(mutationError?.message || "Plan bonusni saqlashda xatolik.");
    }
  };
  const handleEditPlan = (plan: BonusPlan) => {
    setEditingPlanId(plan.id);
    setPlanName(plan.name);
    setPlanCategory(plan.courseCategory);
    setPlanCourseId(plan.courseId || '');
    setPlanTariffId(plan.tariffId || '');
    setPlanSubTariffId(plan.tariffId ? (plan.subTariffId || '') : '');
    setPlanSubTariffName(!plan.tariffId ? normalizeSubTariffName(plan.subTariffName || '') : '');
    setPlanPeriodMode(plan.periodMode);
    setPlanTargetClosedSales(String(plan.targetClosedSales));
    setPlanBonusAmount(String(plan.bonusAmount));
    setPlanActive(plan.isActive);
    setPlanError(null);
    setPlanSuccess(null);
  };
  const handleTogglePlan = async (plan: BonusPlan) => {
    if (!isAdmin) return;
    setPlanError(null);
    setPlanSuccess(null);
    try {
      await updatePlan.mutateAsync({
        id: plan.id,
        isActive: !plan.isActive,
      });
      await plansQuery.refetch();
    } catch (mutationError: any) {
      setPlanError(mutationError?.message || "Plan holatini yangilashda xatolik.");
    }
  };
  const handleDeletePlan = async (planId: string) => {
    if (!isAdmin) return;
    setPlanError(null);
    setPlanSuccess(null);
    if (!window.confirm("Ushbu plan bonusni o'chirishni tasdiqlaysizmi?")) {
      return;
    }
    try {
      await deletePlan.mutateAsync({ id: planId });
      await plansQuery.refetch();
      if (editingPlanId === planId) {
        resetPlanForm();
      }
      setPlanSuccess("Plan bonus o'chirildi.");
    } catch (mutationError: any) {
      setPlanError(mutationError?.message || "Plan bonusni o'chirishda xatolik.");
    }
  };
  const handleRuleModeChange = (category: SalaryCategory, mode: CourseBonusMode) => {
    setBonusRulesState((prev) => {
      const current = prev[category];
      if (!current) return prev;
      return {
        ...prev,
        [category]: {
          ...current,
          mode,
          tiers: current.tiers.length ? current.tiers : [{ minSales: '', maxSales: '', percent: '' }],
        },
      };
    });
  };
  const handleSimplePercentChange = (category: SalaryCategory, value: string) => {
    setBonusRulesState((prev) => {
      const current = prev[category];
      if (!current) return prev;
      return {
        ...prev,
        [category]: {
          ...current,
          simplePercent: value,
        },
      };
    });
  };
  const handleTierChange = (
    category: SalaryCategory,
    tierIndex: number,
    field: 'minSales' | 'maxSales' | 'percent',
    value: string,
  ) => {
    setBonusRulesState((prev) => {
      const current = prev[category];
      if (!current) return prev;
      const nextTiers = [...current.tiers];
      const target = nextTiers[tierIndex];
      if (!target) return prev;
      nextTiers[tierIndex] = {
        ...target,
        [field]: field === 'percent' ? value : value.replace(/[^\d]/g, ''),
      };
      return {
        ...prev,
        [category]: {
          ...current,
          tiers: nextTiers,
        },
      };
    });
  };
  const handleAddTier = (category: SalaryCategory) => {
    setBonusRulesState((prev) => {
      const current = prev[category];
      if (!current) return prev;
      return {
        ...prev,
        [category]: {
          ...current,
          tiers: [...current.tiers, { minSales: '', maxSales: '', percent: '' }],
        },
      };
    });
  };
  const handleRemoveTier = (category: SalaryCategory, tierIndex: number) => {
    setBonusRulesState((prev) => {
      const current = prev[category];
      if (!current) return prev;
      const nextTiers = current.tiers.filter((_, index) => index !== tierIndex);
      return {
        ...prev,
        [category]: {
          ...current,
          tiers: nextTiers.length ? nextTiers : [{ minSales: '', maxSales: '', percent: '' }],
        },
      };
    });
  };

  return { ...prev, resetPlanForm, validateAndBuildBonusRulesPayload, handleSaveBonusRules, handleSaveFixedSalaries, handleSaveAttendancePenaltySettings, handleKpiMetricSlotChange, handleSaveKpiSettings, handleSavePlan, handleEditPlan, handleTogglePlan, handleDeletePlan, handleRuleModeChange, handleSimplePercentChange, handleTierChange, handleAddTier, handleRemoveTier };
}
