'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import MultiSelectDropdown from '@/components/dashboard/multi-select-dropdown';
import { PageHeader } from '@/components/ui/page-header';
import { IconBuilding, IconCash, IconDeviceFloppy, IconLock, IconShieldLock } from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';

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
  // UI-only: which group the left section nav highlights.
  const [activeSection, setActiveSection] = useState('settings-workspace');

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

  const sections = [
    ...(!isTashkiliyOnly
      ? [
        { id: 'settings-workspace', label: 'Ish maydoni', icon: IconBuilding },
        { id: 'settings-salary', label: 'Maosh va bonus sozlamalari', icon: IconCash },
      ]
      : []),
    { id: 'settings-account', label: 'Mening login va parolim', icon: IconShieldLock },
  ];
  const currentSection = sections.some((section) => section.id === activeSection) ? activeSection : sections[0].id;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sozlamalar"
        description="Ish maydoni, bildirishnomalar va dashboard maydonlari sozlamalari."
      />

      {(error || tenantQuery.error || (showLeadSettings && isAdmin && (fieldOptionsQuery.error || amoPipelinesQuery.error)) || success || isTashkiliyOnly || (!isTashkiliyOnly && !isAdmin)) && (
        <div className="space-y-3">
          {error && <p className="alert alert-error">{error}</p>}
          {tenantQuery.error && (
            <p className="alert alert-error">{tenantQuery.error.message}</p>
          )}
          {showLeadSettings && fieldOptionsQuery.error && isAdmin && (
            <p className="alert alert-warning">
              AmoCRM maydonlar katalogi mavjud emas. Jonli tahlil maydonlarini sozlash uchun AmoCRM ni ulang va tekshiring.
            </p>
          )}
          {showLeadSettings && amoPipelinesQuery.error && isAdmin && (
            <p className="alert alert-warning">
              AmoCRM pipelinelari mavjud emas. Avval Integratsiyalar bo'limida AmoCRM ni ulang va pipeline tanlovini saqlang.
            </p>
          )}
          {success && <p className="alert alert-success">{success}</p>}

          {isTashkiliyOnly && (
            <p className="alert alert-info">
              Tashkiliy roli uchun bu sahifada faqat shaxsiy login/parol sozlamalari mavjud.
            </p>
          )}

          {!isTashkiliyOnly && !isAdmin && (
            <p className="alert alert-warning">
              Admin bo'lmagan foydalanuvchilar uchun bu sahifa faqat o'qish rejimida.
            </p>
          )}
        </div>
      )}

      <div className={isTashkiliyOnly ? 'max-w-3xl' : 'grid grid-cols-1 items-start gap-6 lg:grid-cols-[232px_minmax(0,1fr)] xl:gap-10'}>
        {!isTashkiliyOnly && (
          <nav aria-label="Sozlamalar" className="lg:sticky lg:top-20">
            <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
              {sections.map((section) => {
                const SectionIcon = section.icon;
                const active = section.id === currentSection;
                return (
                  <li key={section.id} className="flex-shrink-0">
                    <a
                      href={`#${section.id}`}
                      onClick={() => setActiveSection(section.id)}
                      aria-current={active ? 'true' : undefined}
                      className={`flex h-10 items-center gap-2.5 whitespace-nowrap rounded-full px-4 text-sm font-medium ${
                        active
                          ? 'bg-white text-gray-900 shadow'
                          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                    >
                      <SectionIcon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-blue-600' : 'text-gray-400'}`} stroke={1.8} />
                      {section.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        <div className="min-w-0 space-y-6">
          {!isTashkiliyOnly && (
            <form id="settings-workspace" onSubmit={handleSave} className="panel scroll-mt-24">
              <SectionHead icon={IconBuilding} title="Ish maydoni" />

              <div className="mt-2 divide-y divide-gray-100 px-5 sm:px-6">
                <SettingRow label="Ish maydoni nomi" htmlFor="settings-tenant-name">
                  <input
                    id="settings-tenant-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={!isAdmin}
                    className="field"
                    placeholder="Ish maydoni nomi"
                  />
                </SettingRow>

                <SettingRow label="Telegram xabarnoma Chat ID" htmlFor="settings-chat-id">
                  <input
                    id="settings-chat-id"
                    value={defaultChatId}
                    onChange={(e) => setDefaultChatId(e.target.value)}
                    disabled={!isAdmin}
                    className="field tabular"
                    placeholder="masalan: 123456789"
                  />
                </SettingRow>

                {showLeadSettings && (
                  <>
                    <SettingRow label="Reason Field (Non-Qualified Pie)" htmlFor="settings-reason-field">
                      <select
                        id="settings-reason-field"
                        value={reasonFieldKey}
                        onChange={(e) => setReasonFieldKey(e.target.value)}
                        disabled={!isAdmin || fieldOptionsQuery.isLoading}
                        className="field"
                      >
                        <option value="">Maydon tanlang</option>
                        {fieldOptions.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label} ({option.source})
                          </option>
                        ))}
                      </select>
                    </SettingRow>

                    <SettingRow label="Source Field (New Leads Pie)" htmlFor="settings-source-field">
                      <select
                        id="settings-source-field"
                        value={sourceFieldKey}
                        onChange={(e) => setSourceFieldKey(e.target.value)}
                        disabled={!isAdmin || fieldOptionsQuery.isLoading}
                        className="field"
                      >
                        <option value="">Maydon tanlang</option>
                        {fieldOptions.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label} ({option.source})
                          </option>
                        ))}
                      </select>
                    </SettingRow>

                    <div className="py-5">
                      <MultiSelectDropdown
                        label="Qualified Stages"
                        options={qualifiedStageOptions}
                        selectedIds={qualifiedStageIds}
                        onChange={setQualifiedStageIds}
                        placeholder="Belgilangan pipelinelardan bosqichlarni tanlang"
                        disabled={!isAdmin || amoPipelinesQuery.isLoading}
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-4 py-5 md:grid-cols-2">
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
              </div>

              <div className="flex justify-end border-t border-gray-100 px-5 py-4 sm:px-6">
                <button
                  type="submit"
                  disabled={!isAdmin || updateTenant.isLoading || tenantQuery.isLoading}
                  className="btn btn-primary"
                >
                  <IconDeviceFloppy className="h-4 w-4" stroke={1.8} />
                  {updateTenant.isLoading ? 'Saqlanmoqda...' : 'Sozlamalarni saqlash'}
                </button>
              </div>
            </form>
          )}

          {!isTashkiliyOnly && (
            <section id="settings-salary" className="panel scroll-mt-24 overflow-hidden">
              <div className="flex items-start gap-4 p-5 sm:p-6">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <IconCash className="h-5 w-5" stroke={1.6} />
                </span>
                <div className="min-w-0">
                  <h2 className="section-title">Maosh va bonus sozlamalari</h2>
                  <p className="mt-1.5 max-w-[70ch] text-sm leading-relaxed text-gray-600">
                    Bonus qoidalari va fiks maosh alohida boshqaruv uchun endi <span className="font-semibold text-gray-900">Bonus</span> sahifasiga ko&apos;chirildi.
                    Iltimos, maosh sozlamalarini <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[13px] text-gray-900">/dashboard/bonus</span> orqali o&apos;zgartiring.
                  </p>
                </div>
              </div>
            </section>
          )}

          <form id="settings-account" onSubmit={handleCredentialSave} className="panel scroll-mt-24">
            <SectionHead
              icon={IconShieldLock}
              title="Mening login va parolim"
              description="Bu yerda o'zingizning login va parolingizni o'zgartirasiz."
            />

            {credentialMessage && (
              <div className="px-5 pt-4 sm:px-6">
                <p className="alert alert-success">{credentialMessage}</p>
              </div>
            )}

            <div className="mt-2 divide-y divide-gray-100 px-5 sm:px-6">
              <SettingRow label="Joriy parol" htmlFor="settings-current-password">
                <input
                  id="settings-current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="Joriy parol"
                  aria-label="Joriy parol"
                  className="field"
                />
              </SettingRow>
              <SettingRow label="Yangi login (ixtiyoriy)" htmlFor="settings-new-login">
                <input
                  id="settings-new-login"
                  value={newLogin}
                  onChange={(event) => setNewLogin(event.target.value)}
                  placeholder="Yangi login (ixtiyoriy)"
                  aria-label="Yangi login (ixtiyoriy)"
                  className="field"
                />
              </SettingRow>
              <SettingRow label="Yangi parol (ixtiyoriy)" htmlFor="settings-new-password">
                <input
                  id="settings-new-password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="Yangi parol (ixtiyoriy)"
                  aria-label="Yangi parol (ixtiyoriy)"
                  className="field"
                />
              </SettingRow>
            </div>

            <div className="flex justify-end border-t border-gray-100 px-5 py-4 sm:px-6">
              <button
                type="submit"
                disabled={changeCredentials.isLoading}
                className="btn btn-primary"
              >
                <IconLock className="h-4 w-4" stroke={1.8} />
                {changeCredentials.isLoading ? 'Yangilanmoqda...' : 'Login/parolni yangilash'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function SectionHead({ icon: HeadIcon, title, description }: { icon: Icon; title: string; description?: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-5 sm:px-6">
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-700">
        <HeadIcon className="h-5 w-5" stroke={1.6} />
      </span>
      <div className="min-w-0 pt-0.5">
        <h2 className="section-title">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-gray-500">{description}</p> : null}
      </div>
    </div>
  );
}

function SettingRow({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-2 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:items-center md:gap-8">
      <label htmlFor={htmlFor} className="text-sm font-medium text-gray-900">
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
