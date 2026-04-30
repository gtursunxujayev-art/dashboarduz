'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

type BonusMode = 'on_income' | 'on_debt_closed';
type CourseBonusMode = 'simple' | 'tiered';
type SalaryCategory = 'online' | 'offline' | 'intensive';
type PlanCategory = 'online' | 'offline' | 'intensive' | 'additional_service';
type PlanPeriodMode = 'monthly' | 'all_time';
type PenaltyTarget = 'fixed' | 'kpi';
type BonusTier = {
  minSales: number;
  maxSales: number | null;
  percent: number;
};
type CategoryBonusRule = {
  mode: CourseBonusMode;
  simplePercent: number;
  tiers: BonusTier[];
};
type CategoryBonusRuleState = {
  mode: CourseBonusMode;
  simplePercent: string;
  tiers: Array<{
    minSales: string;
    maxSales: string;
    percent: string;
  }>;
};
type BonusRulesState = Record<SalaryCategory, CategoryBonusRuleState>;

type AgentUserOption = {
  id: string;
  label: string;
};

type BonusPlan = {
  id: string;
  name: string;
  isActive: boolean;
  periodMode: PlanPeriodMode;
  courseCategory: PlanCategory;
  courseId: string | null;
  tariffId: string | null;
  subTariffId: string | null;
  subTariffName?: string | null;
  targetClosedSales: number;
  bonusAmount: number;
  createdAt: string;
  updatedAt: string;
};

type CatalogSubTariff = {
  id: string;
  name: string;
};

type CatalogTariff = {
  id: string;
  name: string;
  subTariffs: CatalogSubTariff[];
};

type CatalogCourse = {
  id: string;
  name: string;
  category: string;
  tariffs: CatalogTariff[];
};

type SubTariffOption = {
  value: string;
  label: string;
};

function parsePercentInput(value: string): number {
  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  if (parsed >= 100) {
    return 100;
  }
  return Number(parsed.toFixed(2));
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseAmountInput(value: string): number {
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) {
    return 0;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatAmount(value?: number | null): string {
  return `${new Intl.NumberFormat('ru-RU').format(value ?? 0)} UZS`;
}

function getCategoryLabel(category: PlanCategory): string {
  if (category === 'online') return 'Online';
  if (category === 'offline') return 'Offline';
  if (category === 'intensive') return 'Intensiv';
  return "Qo'shimcha xizmat";
}

function getPeriodLabel(mode: PlanPeriodMode): string {
  return mode === 'monthly' ? 'Oylik' : 'Umumiy';
}

function normalizeSubTariffName(value: string): string {
  return value.trim().toLowerCase();
}

function getSalaryCategoryLabel(category: SalaryCategory): string {
  if (category === 'online') return 'Online';
  if (category === 'offline') return 'Offline';
  return 'Intensiv';
}

function createDefaultBonusRulesState(): BonusRulesState {
  const emptyTier = { minSales: '', maxSales: '', percent: '' };
  return {
    online: { mode: 'simple', simplePercent: '0', tiers: [emptyTier] },
    offline: { mode: 'simple', simplePercent: '0', tiers: [emptyTier] },
    intensive: { mode: 'simple', simplePercent: '0', tiers: [emptyTier] },
  };
}

function mapRuleToState(rule: CategoryBonusRule | undefined): CategoryBonusRuleState {
  if (!rule || rule.mode === 'simple') {
    return {
      mode: 'simple',
      simplePercent: String(rule?.simplePercent ?? 0),
      tiers: [{ minSales: '', maxSales: '', percent: '' }],
    };
  }
  return {
    mode: 'tiered',
    simplePercent: String(rule.simplePercent ?? 0),
    tiers: rule.tiers.length
      ? rule.tiers.map((tier) => ({
        minSales: String(tier.minSales),
        maxSales: tier.maxSales === null ? '' : String(tier.maxSales),
        percent: String(tier.percent),
      }))
      : [{ minSales: '', maxSales: '', percent: '' }],
  };
}

export default function BonusPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const isAdmin = Boolean(roles.includes('Admin'));
  const isManagerLike = Boolean((roles.includes('Manager') || roles.includes('TeamLeader')) && !isAdmin);
  const canView = isAdmin || isManagerLike;

  const [salaryBonusMode, setSalaryBonusMode] = useState<BonusMode>('on_income');
  const [bonusRulesState, setBonusRulesState] = useState<BonusRulesState>(() => createDefaultBonusRulesState());
  const [fixedSalaryByAgent, setFixedSalaryByAgent] = useState<Record<string, string>>({});
  const [attendancePenaltyLateMinute, setAttendancePenaltyLateMinute] = useState('0');
  const [attendancePenaltyMissingHour, setAttendancePenaltyMissingHour] = useState('0');
  const [attendancePenaltyAbsenceDay, setAttendancePenaltyAbsenceDay] = useState('0');
  const [attendancePenaltyCap, setAttendancePenaltyCap] = useState('0');
  const [attendanceLateTarget, setAttendanceLateTarget] = useState<PenaltyTarget>('kpi');
  const [attendanceMissingTarget, setAttendanceMissingTarget] = useState<PenaltyTarget>('kpi');
  const [attendanceAbsenceTarget, setAttendanceAbsenceTarget] = useState<PenaltyTarget>('fixed');

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

  const updateBonusRulesMutation = trpc.bonus.updateBonusRules.useMutation();
  const updateFixedSalariesMutation = trpc.bonus.updateFixedSalaries.useMutation();
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
    setAttendanceAbsenceTarget(parseTarget(attendanceSettings?.absenceDayPenaltyTarget, 'fixed'));
  }, [salaryConfigQuery.data]);

  const agentUsers = useMemo<AgentUserOption[]>(() => {
    const users = usersQuery.data || [];
    return users
      .filter((currentUser: any) => Array.isArray(currentUser.roles) && currentUser.roles.includes('Agent'))
      .map((currentUser: any) => ({
        id: currentUser.id as string,
        label: (currentUser.name as string | null) || (currentUser.username as string | null) || currentUser.id,
      }));
  }, [usersQuery.data]);

  const plans = useMemo<BonusPlan[]>(
    () => (plansQuery.data?.plans as BonusPlan[] | undefined) || [],
    [plansQuery.data?.plans],
  );

  const catalogCourses = useMemo<CatalogCourse[]>(
    () => (catalogQuery.data?.courses as CatalogCourse[] | undefined) || [],
    [catalogQuery.data?.courses],
  );

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
    const categories: SalaryCategory[] = ['online', 'offline', 'intensive'];
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
      await updateBonusRulesMutation.mutateAsync({
        bonusMode: salaryBonusMode,
        bonusRules: prepared.bonusRules,
      });
      await Promise.all([salaryConfigQuery.refetch(), plansQuery.refetch()]);
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
          || attendanceAbsenceTarget === 'fixed',
        applyToKpi:
          attendanceLateTarget === 'kpi'
          || attendanceMissingTarget === 'kpi'
          || attendanceAbsenceTarget === 'kpi',
        latePenaltyTarget: attendanceLateTarget,
        missingHourPenaltyTarget: attendanceMissingTarget,
        absenceDayPenaltyTarget: attendanceAbsenceTarget,
        monthlyPenaltyCapUZS: parseAmountInput(attendancePenaltyCap),
      });
      await salaryConfigQuery.refetch();
      setSuccess('Davomat jarima sozlamalari saqlandi.');
    } catch (saveError: any) {
      setError(saveError?.message || 'Davomat jarima sozlamalarini saqlashda xatolik.');
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

  if (!canView) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg bg-white p-6 shadow">
          <h1 className="text-xl font-semibold text-gray-900">Bonus</h1>
          <p className="mt-2 text-sm text-red-600">Bu sahifa faqat Admin va Manager/Team lider uchun mavjud.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h1 className="text-xl font-semibold text-gray-900">Bonus</h1>
          <p className="mt-1 text-sm text-gray-500">Agent bonus va fiks maosh sozlamalari.</p>
        </div>

        <div className="p-6">
          {isManagerLike && (
            <p className="mb-4 rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
              Manager/Team lider bu sahifani ko&apos;ra oladi, lekin o&apos;zgartirish faqat Admin uchun ochiq.
            </p>
          )}

          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {success && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}
          {salaryConfigQuery.error && (
            <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{salaryConfigQuery.error.message}</p>
          )}
          {usersQuery.error && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
              Agentlar ro&apos;yxatini yuklashda xatolik.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h2 className="text-lg font-semibold text-gray-900">Bonus qoidalari</h2>
          <p className="mt-1 text-sm text-gray-500">Simple yoki tiered rejimni har bir kurs turi uchun alohida sozlang.</p>
        </div>
        <div className="p-6">
          <form onSubmit={handleSaveBonusRules} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Bonus hisoblash bazasi</label>
                <select
                  value={salaryBonusMode}
                  onChange={(event) => setSalaryBonusMode(event.target.value as BonusMode)}
                  disabled={!isAdmin}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="on_income">Tushum bo&apos;yicha - har bir to&apos;lovda</option>
                  <option value="on_debt_closed">Sotuv yopilganda - qarz 0 bo&apos;lganda</option>
                </select>
              </div>
            </div>

            {(['online', 'offline', 'intensive'] as SalaryCategory[]).map((category) => {
              const rule = bonusRulesState[category];
              if (!rule) return null;
              return (
                <div key={category} className="rounded-md border border-gray-200 bg-gray-50 p-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{getSalaryCategoryLabel(category)}</p>
                      <p className="mt-1 text-xs text-gray-500">Bonus qoidasi</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Rejim</label>
                      <select
                        value={rule.mode}
                        onChange={(event) => handleRuleModeChange(category, event.target.value as CourseBonusMode)}
                        disabled={!isAdmin}
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                      >
                        <option value="simple">Simple</option>
                        <option value="tiered">Tiered</option>
                      </select>
                    </div>
                    {rule.mode === 'simple' ? (
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Foiz (%)</label>
                        <input
                          value={rule.simplePercent}
                          onChange={(event) => handleSimplePercentChange(category, event.target.value)}
                          disabled={!isAdmin}
                          inputMode="decimal"
                          placeholder="0"
                          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Simple foiz (fallback)</label>
                        <input
                          value={rule.simplePercent}
                          onChange={(event) => handleSimplePercentChange(category, event.target.value)}
                          disabled={!isAdmin}
                          inputMode="decimal"
                          placeholder="0"
                          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                        />
                      </div>
                    )}
                  </div>

                  {rule.mode === 'tiered' && (
                    <div className="mt-4 space-y-2">
                      {rule.tiers.map((tier, tierIndex) => (
                        <div key={`${category}-tier-${tierIndex}`} className="grid grid-cols-1 gap-2 md:grid-cols-4">
                          <input
                            value={tier.minSales}
                            onChange={(event) => handleTierChange(category, tierIndex, 'minSales', event.target.value)}
                            disabled={!isAdmin}
                            inputMode="numeric"
                            placeholder="Boshlanish (min)"
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                          />
                          <input
                            value={tier.maxSales}
                            onChange={(event) => handleTierChange(category, tierIndex, 'maxSales', event.target.value)}
                            disabled={!isAdmin}
                            inputMode="numeric"
                            placeholder="Tugash (max), bo'sh=ochiq"
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                          />
                          <input
                            value={tier.percent}
                            onChange={(event) => handleTierChange(category, tierIndex, 'percent', event.target.value)}
                            disabled={!isAdmin}
                            inputMode="decimal"
                            placeholder="Foiz (%)"
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleAddTier(category)}
                              disabled={!isAdmin}
                              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveTier(category, tierIndex)}
                              disabled={!isAdmin}
                              className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              -
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <button
              type="submit"
              disabled={!isAdmin || updateBonusRulesMutation.isLoading || salaryConfigQuery.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {updateBonusRulesMutation.isLoading ? 'Saqlanmoqda...' : "Bonus qoidalarini saqlash"}
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h2 className="text-lg font-semibold text-gray-900">Davomat jarimalari</h2>
          <p className="mt-1 text-sm text-gray-500">
            Face ID davomat ma&apos;lumotlari asosida oylik jarima hisoblash sozlamalari.
          </p>
        </div>
        <div className="p-6">
          <form onSubmit={handleSaveAttendancePenaltySettings} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Kechikish jarimasi (1 daqiqa/UZS)</label>
                <input
                  value={attendancePenaltyLateMinute}
                  onChange={(event) => setAttendancePenaltyLateMinute(event.target.value.replace(/[^\d]/g, ''))}
                  disabled={!isAdmin}
                  inputMode="numeric"
                  placeholder="0"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                />
                <label className="mt-2 block text-xs font-medium text-gray-600">Jarima manbasi</label>
                <select
                  value={attendanceLateTarget}
                  onChange={(event) => setAttendanceLateTarget(event.target.value as PenaltyTarget)}
                  disabled={!isAdmin}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="fixed">Fiks maosh</option>
                  <option value="kpi">KPI</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Yetishmagan vaqt jarimasi (1 soat/UZS)</label>
                <input
                  value={attendancePenaltyMissingHour}
                  onChange={(event) => setAttendancePenaltyMissingHour(event.target.value.replace(/[^\d]/g, ''))}
                  disabled={!isAdmin}
                  inputMode="numeric"
                  placeholder="0"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                />
                <label className="mt-2 block text-xs font-medium text-gray-600">Jarima manbasi</label>
                <select
                  value={attendanceMissingTarget}
                  onChange={(event) => setAttendanceMissingTarget(event.target.value as PenaltyTarget)}
                  disabled={!isAdmin}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="fixed">Fiks maosh</option>
                  <option value="kpi">KPI</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Kelmagan kun jarimasi (1 kun/UZS)</label>
                <input
                  value={attendancePenaltyAbsenceDay}
                  onChange={(event) => setAttendancePenaltyAbsenceDay(event.target.value.replace(/[^\d]/g, ''))}
                  disabled={!isAdmin}
                  inputMode="numeric"
                  placeholder="0"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                />
                <label className="mt-2 block text-xs font-medium text-gray-600">Jarima manbasi</label>
                <select
                  value={attendanceAbsenceTarget}
                  onChange={(event) => setAttendanceAbsenceTarget(event.target.value as PenaltyTarget)}
                  disabled={!isAdmin}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="fixed">Fiks maosh</option>
                  <option value="kpi">KPI</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Oylik maksimal jarima (UZS)</label>
                <input
                  value={attendancePenaltyCap}
                  onChange={(event) => setAttendancePenaltyCap(event.target.value.replace(/[^\d]/g, ''))}
                  disabled={!isAdmin}
                  inputMode="numeric"
                  placeholder="0"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={!isAdmin || updateAttendancePenaltySettingsMutation.isLoading || salaryConfigQuery.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {updateAttendancePenaltySettingsMutation.isLoading ? 'Saqlanmoqda...' : 'Davomat jarimalarini saqlash'}
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h2 className="text-lg font-semibold text-gray-900">Fiks maosh</h2>
          <p className="mt-1 text-sm text-gray-500">Agentlar bo&apos;yicha fiks maoshni alohida saqlang.</p>
        </div>
        <div className="p-6">
          <form onSubmit={handleSaveFixedSalaries} className="space-y-4">
            <div className="mt-2">
              <p className="mt-1 text-xs text-gray-500">
                Formula: Fiks maosh + KPI + Bonus + Plan Bonus.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {agentUsers.length ? (
                  agentUsers.map((agent) => (
                    <label key={agent.id} className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2">
                      <span className="truncate text-sm text-gray-800">{agent.label}</span>
                      <input
                        value={fixedSalaryByAgent[agent.id] || ''}
                        onChange={(event) =>
                          setFixedSalaryByAgent((prev) => ({
                            ...prev,
                            [agent.id]: event.target.value.replace(/[^\d]/g, ''),
                          }))
                        }
                        disabled={!isAdmin}
                        inputMode="numeric"
                        placeholder="0"
                        className="w-28 rounded-md border border-gray-300 bg-white px-2 py-1 text-right text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                      />
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">Agent foydalanuvchilar topilmadi.</p>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={!isAdmin || updateFixedSalariesMutation.isLoading || salaryConfigQuery.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {updateFixedSalariesMutation.isLoading ? 'Saqlanmoqda...' : "Fiks maoshni saqlash"}
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h2 className="text-lg font-semibold text-gray-900">Yangi plan bonus qo&apos;shish</h2>
          <p className="mt-1 text-sm text-gray-500">
            Plan: yopilgan sotuv soni maqsadi + qat&apos;iy bonus summasi.
          </p>
        </div>
        <div className="space-y-4 p-6">
          {planError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{planError}</p>}
          {planSuccess && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{planSuccess}</p>}
          {plansQuery.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{plansQuery.error.message}</p>}
          {catalogQuery.error && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">{catalogQuery.error.message}</p>}

          <form onSubmit={handleSavePlan} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Plan nomi</label>
                <input
                  value={planName}
                  onChange={(event) => setPlanName(event.target.value)}
                  disabled={!isAdmin}
                  placeholder="Masalan: Online premium 10ta"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Davr rejimi</label>
                <select
                  value={planPeriodMode}
                  onChange={(event) => setPlanPeriodMode(event.target.value as PlanPeriodMode)}
                  disabled={!isAdmin}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="monthly">Oylik</option>
                  <option value="all_time">Umumiy</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Kurs turi</label>
                <select
                  value={planCategory}
                  onChange={(event) => {
                    setPlanCategory(event.target.value as PlanCategory);
                    setPlanCourseId('');
                    setPlanTariffId('');
                    setPlanSubTariffId('');
                    setPlanSubTariffName('');
                  }}
                  disabled={!isAdmin}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="online">Online</option>
                  <option value="offline">Offline</option>
                  <option value="intensive">Intensiv</option>
                  <option value="additional_service">Qo&apos;shimcha xizmat</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Kurs (ixtiyoriy)</label>
                <select
                  value={planCourseId}
                  onChange={(event) => {
                    setPlanCourseId(event.target.value);
                    setPlanTariffId('');
                    setPlanSubTariffId('');
                    setPlanSubTariffName('');
                  }}
                  disabled={!isAdmin}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="">Barcha kurslar</option>
                  {courseOptions.map((course) => (
                    <option key={course.id} value={course.id}>{course.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Tarif (ixtiyoriy)</label>
                <select
                  value={planTariffId}
                  onChange={(event) => {
                    setPlanTariffId(event.target.value);
                    setPlanSubTariffId('');
                    setPlanSubTariffName('');
                  }}
                  disabled={!isAdmin || !planCourseId}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="">Barcha tariflar</option>
                  {tariffOptions.map((tariff) => (
                    <option key={tariff.id} value={tariff.id}>{tariff.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Subtarif (ixtiyoriy)</label>
                <select
                  value={planTariffId ? planSubTariffId : planSubTariffName}
                  onChange={(event) => {
                    if (planTariffId) {
                      setPlanSubTariffId(event.target.value);
                      return;
                    }
                    setPlanSubTariffName(event.target.value);
                  }}
                  disabled={!isAdmin || !planCourseId}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="">Barcha subtariflar</option>
                  {subTariffOptions.map((subTariff) => (
                    <option key={subTariff.value} value={subTariff.value}>{subTariff.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Yopilgan sotuv maqsadi</label>
                <input
                  value={planTargetClosedSales}
                  onChange={(event) => setPlanTargetClosedSales(event.target.value.replace(/[^\d]/g, ''))}
                  disabled={!isAdmin}
                  inputMode="numeric"
                  placeholder="Masalan: 5"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Bonus summasi (UZS)</label>
                <input
                  value={planBonusAmount}
                  onChange={(event) => setPlanBonusAmount(event.target.value.replace(/[^\d]/g, ''))}
                  disabled={!isAdmin}
                  inputMode="numeric"
                  placeholder="Masalan: 500000"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Holat</label>
                <select
                  value={planActive ? 'active' : 'inactive'}
                  onChange={(event) => setPlanActive(event.target.value === 'active')}
                  disabled={!isAdmin}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="active">Faol</option>
                  <option value="inactive">Nofaol</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={!isAdmin || createPlan.isLoading || updatePlan.isLoading}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createPlan.isLoading || updatePlan.isLoading
                  ? 'Saqlanmoqda...'
                  : editingPlanId
                    ? 'Plan bonusni yangilash'
                    : "Yangi plan bonus qo'shish"}
              </button>
              {editingPlanId && (
                <button
                  type="button"
                  onClick={resetPlanForm}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Bekor qilish
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h2 className="text-lg font-semibold text-gray-900">Yaratilgan plan bonuslar</h2>
        </div>
        <div className="p-6">
          {plansQuery.isLoading ? (
            <p className="text-sm text-gray-600">Plan bonuslar yuklanmoqda...</p>
          ) : plans.length ? (
            <div className="space-y-3">
              {plans.map((plan) => (
                <div key={plan.id} className="rounded-md border border-gray-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-gray-900">{plan.name}</p>
                      <p className="text-xs text-gray-600">
                        {getCategoryLabel(plan.courseCategory)} | {getPeriodLabel(plan.periodMode)}
                      </p>
                      <p className="text-xs text-gray-600">
                        Kurs: {plan.courseId ? (courseNameById.get(plan.courseId) || '-') : 'Barchasi'} | Tarif: {plan.tariffId ? (courseNameById.get(plan.tariffId) || '-') : 'Barchasi'} | Subtarif: {plan.subTariffId ? (courseNameById.get(plan.subTariffId) || '-') : (plan.subTariffName || 'Barchasi')}
                      </p>
                      <p className="text-xs text-gray-600">
                        Maqsad: {plan.targetClosedSales} ta | Bonus: {formatAmount(plan.bonusAmount)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${plan.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                        {plan.isActive ? 'Faol' : 'Nofaol'}
                      </span>
                      {isAdmin && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleTogglePlan(plan)}
                            disabled={updatePlan.isLoading}
                            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                          >
                            {plan.isActive ? "Nofaol qilish" : 'Faollashtirish'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditPlan(plan)}
                            className="rounded-md border border-blue-300 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-50"
                          >
                            Tahrirlash
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePlan(plan.id)}
                            disabled={deletePlan.isLoading}
                            className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
                          >
                            O&apos;chirish
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-600">Hozircha plan bonuslar mavjud emas.</p>
          )}
        </div>
      </div>
    </div>
  );
}
