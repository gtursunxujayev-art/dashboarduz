'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

type BonusMode = 'on_income' | 'on_debt_closed';
type AgentUserOption = {
  id: string;
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

function parseAmountInput(value: string): number {
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) {
    return 0;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const tenantQuery = trpc.tenant.get.useQuery(undefined, {
    enabled: canView,
  });
  const usersQuery = trpc.users.list.useQuery(undefined, {
    enabled: canView,
    retry: false,
  });
  const updateTenant = trpc.tenant.update.useMutation();

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

  const handleSave = async (event: React.FormEvent) => {
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
      await Promise.all([tenantQuery.refetch(), usersQuery.refetch()]);
      setSuccess("Bonus sozlamalari muvaffaqiyatli saqlandi.");
    } catch (saveError: any) {
      setError(saveError?.message || "Bonus sozlamalarini saqlashda xatolik.");
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
          <p className="mt-1 text-sm text-gray-500">
            Agent bonus va fiks maosh sozlamalari.
          </p>
        </div>

        <div className="p-6">
          {isManager && (
            <p className="mb-4 rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
              Manager bu sahifani ko'ra oladi, lekin o'zgartirish faqat Admin uchun ochiq.
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

          <form onSubmit={handleSave} className="space-y-4">
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
                Formula: Fiks maosh + KPI + Bonus. KPI keyinroq kiritiladi.
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
    </div>
  );
}

