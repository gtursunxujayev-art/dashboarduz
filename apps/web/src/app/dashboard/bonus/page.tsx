'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

type BonusMode = 'on_income' | 'on_debt_closed';
type PlanCategory = 'online' | 'offline' | 'intensive' | 'additional_service';
type PlanPeriodMode = 'monthly' | 'all_time';

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

export default function BonusPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const isAdmin = Boolean(roles.includes('Admin'));
  const isManager = Boolean(roles.includes('Manager') && !isAdmin);
  const canView = isAdmin || isManager;

  const [salaryBonusMode, setSalaryBonusMode] = useState<BonusMode>('on_income');
  const [bonusOnlinePercent, setBonusOnlinePercent] = useState('0');
  const [bonusOfflinePercent, setBonusOfflinePercent] = useState('0');
  const [bonusIntensivePercent, setBonusIntensivePercent] = useState('0');
  const [fixedSalaryByAgent, setFixedSalaryByAgent] = useState<Record<string, string>>({});
  const [salaryExtraSettings, setSalaryExtraSettings] = useState<Record<string, unknown>>({});

  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planName, setPlanName] = useState('');
  const [planCategory, setPlanCategory] = useState<PlanCategory>('online');
  const [planCourseId, setPlanCourseId] = useState('');
  const [planTariffId, setPlanTariffId] = useState('');
  const [planSubTariffId, setPlanSubTariffId] = useState('');
  const [planPeriodMode, setPlanPeriodMode] = useState<PlanPeriodMode>('monthly');
  const [planTargetClosedSales, setPlanTargetClosedSales] = useState('');
  const [planBonusAmount, setPlanBonusAmount] = useState('');
  const [planActive, setPlanActive] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSuccess, setPlanSuccess] = useState<string | null>(null);

  const tenantQuery = trpc.tenant.get.useQuery(undefined, {
    enabled: canView,
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

  const updateTenant = trpc.tenant.update.useMutation();
  const createPlan = trpc.bonus.createPlan.useMutation();
  const updatePlan = trpc.bonus.updatePlan.useMutation();
  const deletePlan = trpc.bonus.deletePlan.useMutation();

  useEffect(() => {
    if (!tenantQuery.data) {
      return;
    }

    const settings = (tenantQuery.data.settings as Record<string, unknown> | null) || {};
    const salarySettings = ((settings.salary as Record<string, unknown> | null) || {});
    setSalaryBonusMode(salarySettings.bonusMode === 'on_debt_closed' ? 'on_debt_closed' : 'on_income');

    const salaryPercentages = ((salarySettings.bonusPercentages as Record<string, unknown> | null) || {});
    setBonusOnlinePercent(String(salaryPercentages.online ?? 0));
    setBonusOfflinePercent(String(salaryPercentages.offline ?? 0));
    setBonusIntensivePercent(String(salaryPercentages.intensive ?? 0));

    const fixedRows = Array.isArray(salarySettings.fixedSalaries)
      ? salarySettings.fixedSalaries
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

    const extraEntries = Object.entries(salarySettings).filter(
      ([key]) => key !== 'bonusMode' && key !== 'bonusPercentages' && key !== 'fixedSalaries',
    );
    setSalaryExtraSettings(Object.fromEntries(extraEntries));
  }, [tenantQuery.data]);

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

  const subTariffOptions = useMemo(
    () => selectedTariff?.subTariffs || [],
    [selectedTariff],
  );

  const resetPlanForm = () => {
    setEditingPlanId(null);
    setPlanName('');
    setPlanCategory('online');
    setPlanCourseId('');
    setPlanTariffId('');
    setPlanSubTariffId('');
    setPlanPeriodMode('monthly');
    setPlanTargetClosedSales('');
    setPlanBonusAmount('');
    setPlanActive(true);
  };

  const handleSaveSalarySettings = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isAdmin) {
      setError("Faqat admin bonus sozlamalarini o'zgartira oladi.");
      return;
    }

    const fixedSalaries = agentUsers
      .map((agent: AgentUserOption) => ({
        userId: agent.id,
        amount: parseAmountInput(fixedSalaryByAgent[agent.id] || ''),
      }))
      .filter((row: { userId: string; amount: number }) => row.amount > 0);

    try {
      await updateTenant.mutateAsync({
        settings: {
          salary: {
            ...salaryExtraSettings,
            bonusMode: salaryBonusMode,
            bonusPercentages: {
              online: parsePercentInput(bonusOnlinePercent),
              offline: parsePercentInput(bonusOfflinePercent),
              intensive: parsePercentInput(bonusIntensivePercent),
            },
            fixedSalaries,
          },
        },
      });
      await Promise.all([tenantQuery.refetch(), usersQuery.refetch(), plansQuery.refetch()]);
      setSuccess("Bonus sozlamalari muvaffaqiyatli saqlandi.");
    } catch (saveError: any) {
      setError(saveError?.message || "Bonus sozlamalarini saqlashda xatolik.");
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
      subTariffId: planSubTariffId || null,
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
    setPlanSubTariffId(plan.subTariffId || '');
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

  if (!canView) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg bg-white p-6 shadow">
          <h1 className="text-xl font-semibold text-gray-900">Bonus</h1>
          <p className="mt-2 text-sm text-red-600">Bu sahifa faqat Admin va Manager uchun mavjud.</p>
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
          {isManager && (
            <p className="mb-4 rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
              Manager bu sahifani ko&apos;ra oladi, lekin o&apos;zgartirish faqat Admin uchun ochiq.
            </p>
          )}

          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {success && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}
          {tenantQuery.error && (
            <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{tenantQuery.error.message}</p>
          )}
          {usersQuery.error && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
              Agentlar ro&apos;yxatini yuklashda xatolik.
            </p>
          )}

          <form onSubmit={handleSaveSalarySettings} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Bonus hisoblash rejimi</label>
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

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Online bonus %</label>
                <input
                  value={bonusOnlinePercent}
                  onChange={(event) => setBonusOnlinePercent(event.target.value)}
                  disabled={!isAdmin}
                  inputMode="decimal"
                  placeholder="0"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Offline bonus %</label>
                <input
                  value={bonusOfflinePercent}
                  onChange={(event) => setBonusOfflinePercent(event.target.value)}
                  disabled={!isAdmin}
                  inputMode="decimal"
                  placeholder="0"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Intensiv bonus %</label>
                <input
                  value={bonusIntensivePercent}
                  onChange={(event) => setBonusIntensivePercent(event.target.value)}
                  disabled={!isAdmin}
                  inputMode="decimal"
                  placeholder="0"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>
            </div>

            <div className="mt-2">
              <p className="text-sm font-medium text-gray-700">Agentlar bo&apos;yicha fiks maosh</p>
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
              disabled={!isAdmin || updateTenant.isLoading || tenantQuery.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {updateTenant.isLoading ? 'Saqlanmoqda...' : 'Bonus sozlamalarini saqlash'}
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
                  value={planSubTariffId}
                  onChange={(event) => setPlanSubTariffId(event.target.value)}
                  disabled={!isAdmin || !planTariffId}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="">Barcha subtariflar</option>
                  {subTariffOptions.map((subTariff) => (
                    <option key={subTariff.id} value={subTariff.id}>{subTariff.name}</option>
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
                        Kurs: {plan.courseId ? (courseNameById.get(plan.courseId) || '-') : 'Barchasi'} | Tarif: {plan.tariffId ? (courseNameById.get(plan.tariffId) || '-') : 'Barchasi'} | Subtarif: {plan.subTariffId ? (courseNameById.get(plan.subTariffId) || '-') : 'Barchasi'}
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
