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
const AGENT_ROLES = new Set(['Agent', 'OnlineAgent', 'OfflineAgent']);

export default function SettingsPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const isAdmin = Boolean(user?.roles?.includes('Admin'));
  const isTashkiliyOnly = Boolean(
    roles.includes('Tashkiliy')
      && !roles.includes('Admin')
      && !roles.includes('Manager')
      && !roles.includes('TeamLeader')
      && !roles.some((role) => AGENT_ROLES.has(role))
      && !roles.includes('Finance'),
  );
  const showLeadSettings = false;

  const [name, setName] = useState('');
  const [defaultChatId, setDefaultChatId] = useState('');
  const [reasonFieldKey, setReasonFieldKey] = useState('');
  const [sourceFieldKey, setSourceFieldKey] = useState('');
  const [qualifiedStageIds, setQualifiedStageIds] = useState<string[]>([]);
  const [qualifiedValues, setQualifiedValues] = useState<string[]>([]);
  const [nonQualifiedValues, setNonQualifiedValues] = useState<string[]>([]);
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

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isAdmin) {
      setError('Faqat tenant admin sozlamalarni yangilashi mumkin.');
      return;
    }

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

          {isTashkiliyOnly && (
            <p className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
              Tashkiliy roli uchun bu sahifada faqat shaxsiy login/parol sozlamalari mavjud.
            </p>
          )}

          {!isTashkiliyOnly && (
            <>
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

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <h3 className="text-base font-semibold text-blue-900">Maosh va bonus sozlamalari</h3>
              <p className="mt-1 text-sm text-blue-800">
                Bonus qoidalari va fiks maosh alohida boshqaruv uchun endi <span className="font-semibold">Bonus</span> sahifasiga ko&apos;chirildi.
                Iltimos, maosh sozlamalarini <span className="font-semibold">/dashboard/bonus</span> orqali o&apos;zgartiring.
              </p>
            </div>

                <button
                  type="submit"
                  disabled={!isAdmin || updateTenant.isLoading || tenantQuery.isLoading}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {updateTenant.isLoading ? 'Saqlanmoqda...' : 'Sozlamalarni saqlash'}
                </button>
              </form>
            </>
          )}

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


