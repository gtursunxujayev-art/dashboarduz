'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import MultiSelectDropdown from '@/components/dashboard/multi-select-dropdown';

type FieldOption = {
  key: string;
  label: string;
  source: 'catalog' | 'system';
};

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

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.roles?.includes('Admin'));
  const isManager = Boolean(user?.roles?.includes('Manager') && !isAdmin);
  const canViewSalarySettings = isAdmin || isManager;
  const showLeadSettings = false;

  const [name, setName] = useState('');
  const [defaultChatId, setDefaultChatId] = useState('');
  const [reasonFieldKey, setReasonFieldKey] = useState('');
  const [sourceFieldKey, setSourceFieldKey] = useState('');
  const [qualifiedStageIds, setQualifiedStageIds] = useState<string[]>([]);
  const [qualifiedValues, setQualifiedValues] = useState<string[]>([]);
  const [nonQualifiedValues, setNonQualifiedValues] = useState<string[]>([]);
  const [salaryBonusMode, setSalaryBonusMode] = useState<BonusMode>('on_income');
  const [bonusOnlinePercent, setBonusOnlinePercent] = useState('0');
  const [bonusOfflinePercent, setBonusOfflinePercent] = useState('0');
  const [bonusIntensivePercent, setBonusIntensivePercent] = useState('0');
  const [fixedSalaryByAgent, setFixedSalaryByAgent] = useState<Record<string, string>>({});
  const [currentPassword, setCurrentPassword] = useState('');
  const [newLogin, setNewLogin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [credentialMessage, setCredentialMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const tenantQuery = trpc.tenant.get.useQuery();
  const fieldOptionsQuery = trpc.dashboard.fieldOptions.useQuery(undefined, {
    enabled: isAdmin && showLeadSettings,
    retry: false,
  });
  const amoPipelinesQuery = trpc.integrations.getAmoCRMPipelines.useQuery(undefined, {
    enabled: isAdmin && showLeadSettings,
    retry: false,
  });
  const usersQuery = trpc.users.list.useQuery(undefined, {
    enabled: canViewSalarySettings,
    retry: false,
  });
  const reasonValueOptionsQuery = trpc.dashboard.reasonValueOptions.useQuery(
    {
      fieldKey: reasonFieldKey || undefined,
      pipelineIds: amoPipelinesQuery.data?.selectedPipelineIds?.length
        ? amoPipelinesQuery.data.selectedPipelineIds
        : undefined,
    },
    {
      enabled: isAdmin && showLeadSettings && Boolean(reasonFieldKey),
      retry: false,
    },
  );
  const updateTenant = trpc.tenant.update.useMutation();
  const changeCredentials = trpc.auth.changeCredentials.useMutation();

  useEffect(() => {
    if (!tenantQuery.data) {
      return;
    }

    setName(tenantQuery.data.name || '');

    const settings = (tenantQuery.data.settings as Record<string, unknown> | null) || {};
    setDefaultChatId(String(settings.notificationChatId || ''));

    const dashboardSettings = ((settings.dashboard as Record<string, unknown> | null) || {});
    setReasonFieldKey(String(dashboardSettings.reasonFieldKey || ''));
    setSourceFieldKey(String(dashboardSettings.sourceFieldKey || ''));
    setQualifiedStageIds(Array.isArray(dashboardSettings.qualifiedStageIds) ? dashboardSettings.qualifiedStageIds.map(String) : []);
    setQualifiedValues(Array.isArray(dashboardSettings.qualifiedValues) ? dashboardSettings.qualifiedValues.map(String) : []);
    setNonQualifiedValues(Array.isArray(dashboardSettings.nonQualifiedValues) ? dashboardSettings.nonQualifiedValues.map(String) : []);

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
  }, [tenantQuery.data]);

  const fieldOptions = useMemo<FieldOption[]>(() => {
    const options = fieldOptionsQuery.data?.options;
    return Array.isArray(options) ? (options as FieldOption[]) : [];
  }, [fieldOptionsQuery.data]);

  const selectedPipelineIds = useMemo(() => {
    if (!amoPipelinesQuery.data) {
      return [];
    }

    if (amoPipelinesQuery.data.hasExplicitSelection) {
      return amoPipelinesQuery.data.selectedPipelineIds;
    }

    return amoPipelinesQuery.data.pipelines.map((pipeline: any) => pipeline.id);
  }, [amoPipelinesQuery.data]);

  const qualifiedStageOptions = useMemo(() => {
    const pipelines = amoPipelinesQuery.data?.pipelines || [];
    return pipelines
      .filter((pipeline: any) => selectedPipelineIds.includes(pipeline.id))
      .flatMap((pipeline: any) =>
        (Array.isArray(pipeline.statuses) ? pipeline.statuses : []).map((status: any) => ({
          id: status.id,
          label: status.name,
          description: pipeline.name,
        })),
      );
  }, [amoPipelinesQuery.data, selectedPipelineIds]);

  const reasonValueOptions = useMemo(() => {
    const values = reasonValueOptionsQuery.data?.values || [];
    return values.map((value: string) => ({ id: value, label: value }));
  }, [reasonValueOptionsQuery.data]);

  const agentUsers = useMemo<AgentUserOption[]>(() => {
    const users = usersQuery.data || [];
    return users
      .filter((user: any) => Array.isArray(user.roles) && user.roles.includes('Agent'))
      .map((user: any) => ({
        id: user.id as string,
        label: (user.name as string | null) || (user.username as string | null) || user.id,
      }));
  }, [usersQuery.data]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isAdmin) {
      setError('Faqat tenant admin sozlamalarni yangilashi mumkin.');
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
        name: name.trim() || undefined,
        settings: {
          notificationChatId: defaultChatId.trim() || null,
          dashboard: {
            reasonFieldKey: reasonFieldKey || null,
            sourceFieldKey: sourceFieldKey || null,
            qualifiedStageIds,
            qualifiedValues,
            nonQualifiedValues,
          },
          salary: {
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
      await tenantQuery.refetch();
      if (isAdmin) {
        await fieldOptionsQuery.refetch();
      }
      setSuccess('Sozlamalar muvaffaqiyatli saqlandi.');
    } catch (err: any) {
      setError(err?.message || 'Sozlamalarni yangilashda xatolik');
    }
  };

  const handleCredentialSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setCredentialMessage(null);

    try {
      await changeCredentials.mutateAsync({
        currentPassword,
        newLogin: newLogin.trim() || undefined,
        newPassword: newPassword.trim() || undefined,
      });
      setCurrentPassword('');
      setNewPassword('');
      setCredentialMessage("Login/parol ma'lumotlari muvaffaqiyatli yangilandi.");
    } catch (mutationError: any) {
      setError(mutationError?.message || "Login/parolni yangilashda xatolik");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h1 className="text-xl font-semibold text-gray-900">Sozlamalar</h1>
          <p className="mt-1 text-sm text-gray-500">
            Ish maydoni, bildirishnomalar va dashboard maydonlari sozlamalari.
          </p>
        </div>

        <div className="p-6">
          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {tenantQuery.error && (
            <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{tenantQuery.error.message}</p>
          )}
          {showLeadSettings && fieldOptionsQuery.error && isAdmin && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
              AmoCRM maydonlar katalogi mavjud emas. Jonli tahlil maydonlarini sozlash uchun AmoCRM ni ulang va tekshiring.
            </p>
          )}
          {showLeadSettings && amoPipelinesQuery.error && isAdmin && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
              AmoCRM pipelinelari mavjud emas. Avval Integratsiyalar bo'limida AmoCRM ni ulang va pipeline tanlovini saqlang.
            </p>
          )}
          {success && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}

          {!isAdmin && (
            <p className="mb-4 rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
              Admin bo'lmagan foydalanuvchilar uchun bu sahifa faqat o'qish rejimida.
            </p>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Ish maydoni nomi</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isAdmin}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                placeholder="Ish maydoni nomi"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Telegram xabarnoma Chat ID</label>
              <input
                value={defaultChatId}
                onChange={(e) => setDefaultChatId(e.target.value)}
                disabled={!isAdmin}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                placeholder="masalan: 123456789"
              />
            </div>

            {showLeadSettings && (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Reason Field (Non-Qualified Pie)</label>
                    <select
                      value={reasonFieldKey}
                      onChange={(e) => setReasonFieldKey(e.target.value)}
                      disabled={!isAdmin || fieldOptionsQuery.isLoading}
                      style={{ backgroundColor: '#FFFFFF', color: '#111827' }}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                    >
                      <option value="" style={{ backgroundColor: '#FFFFFF', color: '#111827' }}>Maydon tanlang</option>
                      {fieldOptions.map((option) => (
                        <option key={option.key} value={option.key} style={{ backgroundColor: '#FFFFFF', color: '#111827' }}>
                          {option.label} ({option.source})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Source Field (New Leads Pie)</label>
                    <select
                      value={sourceFieldKey}
                      onChange={(e) => setSourceFieldKey(e.target.value)}
                      disabled={!isAdmin || fieldOptionsQuery.isLoading}
                      style={{ backgroundColor: '#FFFFFF', color: '#111827' }}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                    >
                      <option value="" style={{ backgroundColor: '#FFFFFF', color: '#111827' }}>Maydon tanlang</option>
                      {fieldOptions.map((option) => (
                        <option key={option.key} value={option.key} style={{ backgroundColor: '#FFFFFF', color: '#111827' }}>
                          {option.label} ({option.source})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <MultiSelectDropdown
                  label="Qualified Stages"
                  options={qualifiedStageOptions}
                  selectedIds={qualifiedStageIds}
                  onChange={setQualifiedStageIds}
                  placeholder="Belgilangan pipelinelardan bosqichlarni tanlang"
                  disabled={!isAdmin || amoPipelinesQuery.isLoading}
                />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <MultiSelectDropdown
                    label="Qualified Values"
                    options={reasonValueOptions}
                    selectedIds={qualifiedValues}
                    onChange={setQualifiedValues}
                    placeholder={reasonFieldKey ? "Tanlangan sabab maydonidan qiymatlarni tanlang" : "Avval sabab maydonini tanlang"}
                    disabled={!isAdmin || !reasonFieldKey}
                    loading={reasonValueOptionsQuery.isLoading}
                    loadingText="Tanlangan sabab maydoni qiymatlari yuklanmoqda..."
                    emptyText="Bu sabab maydoni uchun hozircha qiymatlar topilmadi."
                  />

                  <MultiSelectDropdown
                    label="Non-Qualified Values"
                    options={reasonValueOptions}
                    selectedIds={nonQualifiedValues}
                    onChange={setNonQualifiedValues}
                    placeholder={reasonFieldKey ? "Tanlangan sabab maydonidan qiymatlarni tanlang" : "Avval sabab maydonini tanlang"}
                    disabled={!isAdmin || !reasonFieldKey}
                    loading={reasonValueOptionsQuery.isLoading}
                    loadingText="Tanlangan sabab maydoni qiymatlari yuklanmoqda..."
                    emptyText="Bu sabab maydoni uchun hozircha qiymatlar topilmadi."
                  />
                </div>
              </>
            )}

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <h3 className="text-base font-semibold text-gray-900">Maosh sozlamalari</h3>
              <p className="mt-1 text-sm text-gray-600">
                Maosh formulasi: <span className="font-medium">Fiks maosh + KPI + Bonus</span>. KPI qoidalari kiritilmaguncha 0 bo'ladi.
              </p>

              {usersQuery.error && canViewSalarySettings && (
                <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  Agentlar ro'yxatini yuklab bo'lmadi.
                </p>
              )}

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Bonus hisoblash rejimi</label>
                  <select
                    value={salaryBonusMode}
                    onChange={(event) => setSalaryBonusMode(event.target.value as BonusMode)}
                    disabled={!isAdmin}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    <option value="on_income">Tushum bo'yicha - har bir to'lovda</option>
                    <option value="on_debt_closed">Sotuv yopilganda - qarz 0 bo'lganda</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
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

              <div className="mt-4">
                <p className="text-sm font-medium text-gray-700">Agentlar bo'yicha fiks maosh</p>
                <p className="mt-1 text-xs text-gray-500">
                  Har bir agent uchun oylik fiks maoshni kiriting. Bo'sh yoki 0 bo'lsa, fiks maosh berilmaydi.
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
                    <p className="text-sm text-gray-500">Hozircha agent foydalanuvchilar topilmadi.</p>
                  )}
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={!isAdmin || updateTenant.isLoading || tenantQuery.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {updateTenant.isLoading ? 'Saqlanmoqda...' : 'Sozlamalarni saqlash'}
            </button>
          </form>

          <div className="mt-8 border-t border-gray-100 pt-6">
            <h2 className="text-base font-semibold text-gray-900">Mening login va parolim</h2>
            <p className="mt-1 text-sm text-gray-500">
              Bu yerda o'zingizning login va parolingizni o'zgartirasiz.
            </p>

            {credentialMessage && (
              <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{credentialMessage}</p>
            )}

            <form onSubmit={handleCredentialSave} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                placeholder="Joriy parol"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                value={newLogin}
                onChange={(event) => setNewLogin(event.target.value)}
                placeholder="Yangi login (ixtiyoriy)"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="Yangi parol (ixtiyoriy)"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={changeCredentials.isLoading}
                className="w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {changeCredentials.isLoading ? 'Yangilanmoqda...' : 'Login/parolni yangilash'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}


