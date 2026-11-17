'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { UserAvatar } from '@/components/ui/user-avatar';
import { roleNeedsManagerMapping } from '@dashboarduz/shared';
import { IconKey, IconRefresh, IconUserCheck, IconUserOff, IconUserPlus, IconUsers } from '@tabler/icons-react';

const availableRoles = ['Admin', 'Manager', 'TeamLeader', 'Agent', 'OnlineAgent', 'OfflineAgent', 'Dashboard', 'OfflineDashboard', 'Finance', 'Tashkiliy'] as const;
const roleLabels: Record<(typeof availableRoles)[number], string> = {
  Admin: 'Admin',
  Manager: 'Menejer',
  TeamLeader: 'Team lider',
  Agent: 'Agent',
  OnlineAgent: 'Online agent',
  OfflineAgent: 'Offline agent',
  Dashboard: 'Dashboard',
  OfflineDashboard: 'Offline dashboard',
  Finance: 'Moliya',
  Tashkiliy: 'Tashkiliy',
};

type UserRole = (typeof availableRoles)[number];

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const isAdmin = Boolean(currentUser?.roles?.includes('Admin'));
  const usersQuery = trpc.users.list.useQuery();
  const amocrmManagersQuery = trpc.users.amocrmManagers.useQuery(undefined, {
    retry: false,
  });
  const utelManagersQuery = trpc.users.utelManagers.useQuery(undefined, {
    retry: false,
  });
  const telegramRecipientsQuery = trpc.users.telegramRecipients.useQuery(undefined, {
    retry: false,
    refetchInterval: 15_000,
  });
  const createUser = trpc.users.create.useMutation();
  const updateName = trpc.users.updateName.useMutation();
  const updateRole = trpc.users.updateRole.useMutation();
  const updateCredentials = trpc.users.updateCredentials.useMutation();
  const setActiveMutation = trpc.users.setActive.useMutation();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{ login: string; password: string } | null>(null);
  const [generatedResetPassword, setGeneratedResetPassword] = useState<{ userId: string; password: string } | null>(null);

  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('Agent');
  const [newAmoManagerId, setNewAmoManagerId] = useState('');
  const [newUtelManagerId, setNewUtelManagerId] = useState('');
  const [newTelegramChatId, setNewTelegramChatId] = useState('');

  const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>({});
  const [managerDrafts, setManagerDrafts] = useState<Record<string, string>>({});
  const [utelDrafts, setUtelDrafts] = useState<Record<string, string>>({});
  const [telegramDrafts, setTelegramDrafts] = useState<Record<string, string>>({});
  const [loginDrafts, setLoginDrafts] = useState<Record<string, string>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [phoneDrafts, setPhoneDrafts] = useState<Record<string, string>>({});

  const amocrmManagers = useMemo(() => amocrmManagersQuery.data || [], [amocrmManagersQuery.data]);
  const utelManagers = useMemo(() => utelManagersQuery.data || [], [utelManagersQuery.data]);
  const telegramRecipients = useMemo(() => telegramRecipientsQuery.data || [], [telegramRecipientsQuery.data]);

  useEffect(() => {
    const users = usersQuery.data || [];
    const nextRoleDrafts: Record<string, UserRole> = {};
    const nextManagerDrafts: Record<string, string> = {};
    const nextUtelDrafts: Record<string, string> = {};
    const nextTelegramDrafts: Record<string, string> = {};
    const nextLoginDrafts: Record<string, string> = {};
    const nextNameDrafts: Record<string, string> = {};
    const nextPhoneDrafts: Record<string, string> = {};

    for (const user of users as any[]) {
      nextRoleDrafts[user.id] = (user.roles?.[0] || 'Agent') as UserRole;
      nextManagerDrafts[user.id] = user.amocrmResponsibleUserId || '';
      nextUtelDrafts[user.id] = user.utelManagerExternalId || '';
      nextTelegramDrafts[user.id] = user.telegramId || '';
      nextLoginDrafts[user.id] = user.username || '';
      nextNameDrafts[user.id] = user.name || '';
      nextPhoneDrafts[user.id] = user.phone || '';
    }

    setRoleDrafts(nextRoleDrafts);
    setManagerDrafts(nextManagerDrafts);
    setUtelDrafts(nextUtelDrafts);
    setTelegramDrafts(nextTelegramDrafts);
    setLoginDrafts(nextLoginDrafts);
    setNameDrafts(nextNameDrafts);
    setPhoneDrafts(nextPhoneDrafts);
  }, [usersQuery.data]);

  const handleCreateUser = async () => {
    setError(null);
    setSuccess(null);
    setCreatedCredentials(null);
    setGeneratedResetPassword(null);

    try {
      const created = await createUser.mutateAsync({
        name: newName.trim() || undefined,
        phone: newPhone.trim() || undefined,
        role: newRole,
        amocrmResponsibleUserId: roleNeedsManagerMapping(newRole) ? (newAmoManagerId || undefined) : undefined,
        utelManagerExternalId: roleNeedsManagerMapping(newRole) ? (newUtelManagerId || undefined) : undefined,
        telegramChatId: newTelegramChatId || undefined,
      });

      setCreatedCredentials(created.credentials);
      setNewName('');
      setNewPhone('');
      setNewRole('Agent');
      setNewAmoManagerId('');
      setNewUtelManagerId('');
      setNewTelegramChatId('');
      setSuccess("Foydalanuvchi muvaffaqiyatli yaratildi.");
      await usersQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || "Foydalanuvchini yaratishda xatolik");
    }
  };

  const handleRoleSave = async (userId: string) => {
    setError(null);
    setSuccess(null);
    setGeneratedResetPassword(null);

    try {
      await updateRole.mutateAsync({
        userId,
        roles: [roleDrafts[userId] || 'Agent'],
        amocrmResponsibleUserId: roleNeedsManagerMapping(roleDrafts[userId] || 'Agent')
          ? (managerDrafts[userId] || undefined)
          : undefined,
        utelManagerExternalId: roleNeedsManagerMapping(roleDrafts[userId] || 'Agent')
          ? (utelDrafts[userId] || undefined)
          : undefined,
        telegramChatId: telegramDrafts[userId] || undefined,
      });
      setSuccess("Foydalanuvchi roli va menejer bog'lanishi saqlandi.");
      await usersQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || "Rolni yangilashda xatolik");
    }
  };

  const handleNameSave = async (userId: string) => {
    setError(null);
    setSuccess(null);
    setGeneratedResetPassword(null);

    try {
      await updateName.mutateAsync({
        userId,
        name: nameDrafts[userId] || undefined,
        phone: phoneDrafts[userId] ?? '',
      });
      setSuccess("Foydalanuvchi ismi saqlandi.");
      await usersQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || "Foydalanuvchi ismini yangilashda xatolik");
    }
  };

  const handleCredentialsSave = async (userId: string) => {
    setError(null);
    setSuccess(null);
    setGeneratedResetPassword(null);

    try {
      await updateCredentials.mutateAsync({
        userId,
        username: loginDrafts[userId] || undefined,
        password: passwordDrafts[userId] || undefined,
      });
      setPasswordDrafts((prev) => ({ ...prev, [userId]: '' }));
      setSuccess("Foydalanuvchi login/paroli saqlandi.");
      await usersQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || "Login/parolni yangilashda xatolik");
    }
  };

  const handleGeneratePassword = async (userId: string) => {
    setError(null);
    setSuccess(null);
    setGeneratedResetPassword(null);

    try {
      const result = await updateCredentials.mutateAsync({
        userId,
        generatePassword: true,
      });
      if (result.generatedPassword) {
        setGeneratedResetPassword({ userId, password: result.generatedPassword });
        setSuccess("Yangi parol muvaffaqiyatli yaratildi.");
      }
    } catch (mutationError: any) {
      setError(mutationError?.message || "Parol yaratishda xatolik");
    }
  };

  const handleToggleActive = async (userId: string, nextIsActive: boolean) => {
    setError(null);
    setSuccess(null);
    setGeneratedResetPassword(null);

    try {
      await setActiveMutation.mutateAsync({
        userId,
        isActive: nextIsActive,
      });
      setSuccess(nextIsActive ? "Foydalanuvchi faollashtirildi." : "Foydalanuvchi nofaol qilindi.");
      await usersQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || "Foydalanuvchi holatini yangilashda xatolik");
    }
  };

  const users = (usersQuery.data || []) as any[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Foydalanuvchilar"
        description="Foydalanuvchi yarating, agentni AmoCRM/UTeL menejeriga bog'lang va login/parolni boshqaring."
        actions={
          <button
            type="button"
            onClick={() => telegramRecipientsQuery.refetch()}
            disabled={telegramRecipientsQuery.isFetching}
            className="btn btn-secondary"
          >
            <IconRefresh className={`h-4 w-4 ${telegramRecipientsQuery.isFetching ? 'animate-spin' : ''}`} stroke={1.8} />
            {telegramRecipientsQuery.isFetching ? 'Yangilanmoqda...' : "Telegram ro'yxatini yangilash"}
          </button>
        }
      />

      {(error || success || amocrmManagersQuery.error || utelManagersQuery.error || telegramRecipientsQuery.error || createdCredentials) && (
        <div className="space-y-3">
          {error && <p className="alert alert-error">{error}</p>}
          {success && <p className="alert alert-success">{success}</p>}
          {amocrmManagersQuery.error && (
            <p className="alert alert-warning">
              AmoCRM menejerlari topilmadi. Agentlarni bog'lash uchun AmoCRM integratsiyasini ulang.
            </p>
          )}
          {utelManagersQuery.error && (
            <p className="alert alert-warning">
              UTeL menejerlari topilmadi. Ro'yxat uchun UTeL qo'ng'iroqlari kelishi kerak.
            </p>
          )}
          {telegramRecipientsQuery.error && (
            <p className="alert alert-warning">
              Telegram bot foydalanuvchilari topilmadi. Integratsiyalar bo'limida botni ulang va /start yuboring.
            </p>
          )}
          {createdCredentials && (
            <p className="alert alert-success">
              Foydalanuvchi yaratildi. Login: <strong>{createdCredentials.login}</strong>, Parol: <strong>{createdCredentials.password}</strong>
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="panel 2xl:sticky 2xl:top-6 2xl:order-2">
          <div className="panel-header">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-blue-50 text-blue-600">
                <IconUserPlus className="h-[18px] w-[18px]" stroke={1.8} />
              </span>
              <h2 className="section-title">Yangi foydalanuvchi</h2>
            </div>
          </div>
          <div className="panel-body grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-1">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Foydalanuvchi ismi (ixtiyoriy)"
              className="field min-w-0"
            />
            <input
              value={newPhone}
              onChange={(event) => setNewPhone(event.target.value)}
              placeholder="Telefon raqam (ixtiyoriy)"
              className="field min-w-0"
            />
            <select
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as UserRole)}
              className="field min-w-0"
            >
              {availableRoles.map((role) => (
                <option key={role} value={role}>
                  {roleLabels[role]}
                </option>
              ))}
            </select>
            <select
              value={newAmoManagerId}
              onChange={(event) => setNewAmoManagerId(event.target.value)}
              disabled={!roleNeedsManagerMapping(newRole)}
              className="field min-w-0"
            >
              <option value="">{roleNeedsManagerMapping(newRole) ? 'AmoCRM menejerini tanlang' : 'Bu rol uchun shart emas'}</option>
              {amocrmManagers.map((manager: any) => (
                <option key={manager.id} value={manager.id}>
                  {manager.name}
                </option>
              ))}
            </select>
            <select
              value={newUtelManagerId}
              onChange={(event) => setNewUtelManagerId(event.target.value)}
              disabled={!roleNeedsManagerMapping(newRole)}
              className="field min-w-0"
            >
              <option value="">{roleNeedsManagerMapping(newRole) ? 'UTeL menejerini tanlang' : 'Bu rol uchun shart emas'}</option>
              {utelManagers.map((manager: any) => (
                <option key={manager.id} value={manager.id}>
                  {manager.name}
                </option>
              ))}
            </select>
            <select
              value={newTelegramChatId}
              onChange={(event) => setNewTelegramChatId(event.target.value)}
              className="field min-w-0"
            >
              <option value="">Telegram (ixtiyoriy)</option>
              {telegramRecipients.map((recipient: any) => (
                <option key={recipient.id} value={recipient.id}>
                  {recipient.name}{recipient.username ? ` (@${recipient.username})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end border-t border-gray-100 px-5 py-4 sm:px-6">
            <button
              type="button"
              onClick={handleCreateUser}
              disabled={createUser.isLoading}
              className="btn btn-primary w-full sm:w-auto 2xl:w-full"
            >
              <IconUserPlus className="h-4 w-4" stroke={1.8} />
              {createUser.isLoading ? 'Yaratilmoqda...' : "Foydalanuvchi qo'shish"}
            </button>
          </div>
        </section>

        <section className="panel min-w-0 2xl:order-1">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <h2 className="section-title">Ish maydoni foydalanuvchilari</h2>
              {users.length > 0 && <span className="badge badge-neutral tabular">{users.length}</span>}
            </div>
          </div>

          <div className="p-2 pt-3 sm:p-3 sm:pt-4">
            {usersQuery.isLoading ? (
              <LoadingBlock message="Foydalanuvchilar yuklanmoqda..." className="m-2" />
            ) : users.length ? (
              <ul className="divide-y divide-gray-100">
                {users.map((user) => {
                  const resetState = generatedResetPassword;
                  const generatedPasswordForRow =
                    resetState && resetState.userId === user.id ? resetState.password : null;
                  const userRoles: string[] = Array.isArray(user.roles) ? user.roles : [];

                  return (
                    <li key={user.id} className="space-y-4 px-3 py-5 first:pt-2">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          <UserAvatar name={user.name || user.username || '?'} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-medium text-gray-900">{user.name || user.username || user.id}</p>
                              {userRoles.map((role) => (
                                <span key={role} className="badge badge-blue">{roleLabels[role as UserRole] || role}</span>
                              ))}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-gray-500">ID: {user.id}</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                          <div>
                            <p className="text-xs text-gray-500">Oxirgi kirish</p>
                            <p className="tabular mt-0.5 text-sm text-gray-700">
                              {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Hech qachon'}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500">Holat</p>
                            <span className={`badge mt-0.5 ${user.isActive ? 'badge-green' : 'badge-amber'}`}>
                              {user.isActive ? 'Faol' : 'Nofaol'}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(user.id, !user.isActive)}
                            disabled={!isAdmin || setActiveMutation.isLoading}
                            className={`btn btn-sm ${user.isActive ? 'btn-secondary' : 'btn-soft'}`}
                          >
                            {user.isActive ? <IconUserOff className="h-4 w-4" stroke={1.8} /> : <IconUserCheck className="h-4 w-4" stroke={1.8} />}
                            {!isAdmin
                              ? "Faqat admin"
                              : setActiveMutation.isLoading
                              ? 'Saqlanmoqda...'
                              : user.isActive
                                ? 'Nofaol qilish'
                                : 'Faollashtirish'}
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        <div className="panel-inset space-y-2.5">
                          <p className="text-xs font-medium text-gray-500">Foydalanuvchi</p>
                          <input
                            value={nameDrafts[user.id] || ''}
                            onChange={(event) =>
                              setNameDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))
                            }
                            placeholder="Foydalanuvchi ismi"
                            className="field"
                          />
                          <input
                            value={phoneDrafts[user.id] || ''}
                            onChange={(event) =>
                              setPhoneDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))
                            }
                            placeholder="Telefon raqam"
                            className="field"
                          />
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleNameSave(user.id)}
                              disabled={updateName.isLoading}
                              className="btn btn-secondary btn-sm"
                            >
                              {updateName.isLoading ? 'Saqlanmoqda...' : "Ism/telefonni saqlash"}
                            </button>
                          </div>
                        </div>

                        <div className="panel-inset space-y-2.5">
                          <p className="text-xs font-medium text-gray-500">Login/Parol</p>
                          <input
                            value={loginDrafts[user.id] || ''}
                            onChange={(event) =>
                              setLoginDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))
                            }
                            placeholder="Login"
                            className="field"
                          />
                          <input
                            type="password"
                            value={passwordDrafts[user.id] || ''}
                            onChange={(event) =>
                              setPasswordDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))
                            }
                            placeholder="Yangi parol"
                            className="field"
                          />
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleGeneratePassword(user.id)}
                              className="btn btn-soft btn-sm"
                            >
                              <IconKey className="h-4 w-4" stroke={1.8} />
                              Yaratish
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCredentialsSave(user.id)}
                              className="btn btn-secondary btn-sm"
                            >
                              Saqlash
                            </button>
                          </div>
                          {generatedPasswordForRow && (
                            <p className="alert alert-success px-3 py-2 text-xs">
                              Yangi yaratilgan parol: <strong>{generatedPasswordForRow}</strong>
                            </p>
                          )}
                        </div>

                        <div className="panel-inset space-y-2.5 lg:col-span-2">
                          <p className="text-xs font-medium text-gray-500">Rol + CRM/UTeL/Telegram</p>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[150px_1fr_1fr_1fr_auto]">
                            <select
                              value={roleDrafts[user.id] || 'Agent'}
                              onChange={(event) =>
                                setRoleDrafts((prev) => ({ ...prev, [user.id]: event.target.value as UserRole }))
                              }
                              className="field min-w-0"
                            >
                              {availableRoles.map((role) => (
                                <option key={role} value={role}>
                                  {roleLabels[role]}
                                </option>
                              ))}
                            </select>
                            <select
                              value={managerDrafts[user.id] || ''}
                              onChange={(event) =>
                                setManagerDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))
                              }
                              disabled={!roleNeedsManagerMapping(roleDrafts[user.id] || 'Agent')}
                              className="field min-w-0"
                            >
                              <option value="">
                                {roleNeedsManagerMapping(roleDrafts[user.id] || 'Agent')
                                  ? 'AmoCRM menejerini tanlang'
                                  : 'Bu rol uchun shart emas'}
                              </option>
                              {amocrmManagers.map((manager: any) => (
                                <option key={manager.id} value={manager.id}>
                                  {manager.name}
                                </option>
                              ))}
                            </select>
                            <select
                              value={utelDrafts[user.id] || ''}
                              onChange={(event) =>
                                setUtelDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))
                              }
                              disabled={!roleNeedsManagerMapping(roleDrafts[user.id] || 'Agent')}
                              className="field min-w-0"
                            >
                              <option value="">
                                {roleNeedsManagerMapping(roleDrafts[user.id] || 'Agent')
                                  ? 'UTeL menejerini tanlang'
                                  : 'Bu rol uchun shart emas'}
                              </option>
                              {utelManagers.map((manager: any) => (
                                <option key={manager.id} value={manager.id}>
                                  {manager.name}
                                </option>
                              ))}
                            </select>
                            <select
                              value={telegramDrafts[user.id] || ''}
                              onChange={(event) =>
                                setTelegramDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))
                              }
                              className="field min-w-0"
                            >
                              <option value="">Telegram (ixtiyoriy)</option>
                              {telegramRecipients.map((recipient: any) => (
                                <option key={recipient.id} value={recipient.id}>
                                  {recipient.name}{recipient.username ? ` (@${recipient.username})` : ''}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => handleRoleSave(user.id)}
                              className="btn btn-secondary sm:col-span-2 xl:col-span-1"
                            >
                              Saqlash
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={IconUsers} title="Bu ish maydonida foydalanuvchi topilmadi." className="m-2" />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
