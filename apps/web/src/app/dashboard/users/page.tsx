'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { UserAvatar } from '@/components/ui/user-avatar';
import { roleNeedsManagerMapping } from '@dashboarduz/shared';
import { IconPencil, IconRefresh, IconSearch, IconUserCheck, IconUserOff, IconUserPlus, IconUsers } from '@tabler/icons-react';
import { UserCreateSheet } from './_components/user-create-sheet';
import { UserEditSheet } from './_components/user-edit-sheet';
import { availableRoles, roleLabels } from './_components/user-roles';
import type { UserRole } from './_components/user-roles';

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const isAdmin = Boolean(currentUser?.roles?.includes('Admin'));
  const usersQuery = trpc.users.list.useQuery();
  const amocrmManagersQuery = trpc.users.amocrmManagers.useQuery(undefined, {
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
  const [newTelegramChatId, setNewTelegramChatId] = useState('');

  const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>({});
  const [managerDrafts, setManagerDrafts] = useState<Record<string, string>>({});
  const [telegramDrafts, setTelegramDrafts] = useState<Record<string, string>>({});
  const [loginDrafts, setLoginDrafts] = useState<Record<string, string>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [phoneDrafts, setPhoneDrafts] = useState<Record<string, string>>({});

  // UI-only: which sheet is open and how the directory is filtered.
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [search, setSearch] = useState('');

  const amocrmManagers = useMemo(() => amocrmManagersQuery.data || [], [amocrmManagersQuery.data]);
  const telegramRecipients = useMemo(() => telegramRecipientsQuery.data || [], [telegramRecipientsQuery.data]);

  useEffect(() => {
    const users = usersQuery.data || [];
    const nextRoleDrafts: Record<string, UserRole> = {};
    const nextManagerDrafts: Record<string, string> = {};
    const nextTelegramDrafts: Record<string, string> = {};
    const nextLoginDrafts: Record<string, string> = {};
    const nextNameDrafts: Record<string, string> = {};
    const nextPhoneDrafts: Record<string, string> = {};

    for (const user of users as any[]) {
      nextRoleDrafts[user.id] = (user.roles?.[0] || 'Agent') as UserRole;
      nextManagerDrafts[user.id] = user.amocrmResponsibleUserId || '';
      nextTelegramDrafts[user.id] = user.telegramId || '';
      nextLoginDrafts[user.id] = user.username || '';
      nextNameDrafts[user.id] = user.name || '';
      nextPhoneDrafts[user.id] = user.phone || '';
    }

    setRoleDrafts(nextRoleDrafts);
    setManagerDrafts(nextManagerDrafts);
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
        telegramChatId: newTelegramChatId || undefined,
      });

      setCreatedCredentials(created.credentials);
      setNewName('');
      setNewPhone('');
      setNewRole('Agent');
      setNewAmoManagerId('');
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

  const roleCounts = new Map<string, number>();
  for (const user of users) {
    for (const role of (Array.isArray(user.roles) ? user.roles : []) as string[]) {
      roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
    }
  }
  const roleFilters = availableRoles.filter((role) => roleCounts.has(role));
  const searchQuery = search.trim().toLowerCase();
  const visibleUsers = users.filter((user) => {
    if (roleFilter !== 'all' && !(Array.isArray(user.roles) && user.roles.includes(roleFilter))) {
      return false;
    }
    if (!searchQuery) {
      return true;
    }
    return [user.name, user.username, user.phone, user.id]
      .some((value) => String(value || '').toLowerCase().includes(searchQuery));
  });
  const editingUser = editingUserId ? users.find((user) => user.id === editingUserId) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Foydalanuvchilar"
        description="Foydalanuvchi yarating, agentni AmoCRM menejeriga bog'lang va login/parolni boshqaring."
        actions={
          <>
            <button
              type="button"
              onClick={() => telegramRecipientsQuery.refetch()}
              disabled={telegramRecipientsQuery.isFetching}
              className="btn btn-secondary"
            >
              <IconRefresh className={`h-4 w-4 ${telegramRecipientsQuery.isFetching ? 'animate-spin' : ''}`} stroke={1.8} />
              {telegramRecipientsQuery.isFetching ? 'Yangilanmoqda...' : "Telegram ro'yxatini yangilash"}
            </button>
            <button type="button" onClick={() => setCreateOpen(true)} className="btn btn-primary">
              <IconUserPlus className="h-4 w-4" stroke={1.8} />
              Foydalanuvchi qo&apos;shish
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative w-full lg:max-w-xs">
            <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Ism, login yoki telefon bo'yicha qidirish"
              aria-label="Ism, login yoki telefon bo'yicha qidirish"
              className="field rounded-full pl-10 shadow-sm"
            />
          </div>
          {roleFilters.length > 0 && (
            <div className="-mx-1 min-w-0 overflow-x-auto px-1 py-1">
              <div className="segmented" role="group" aria-label="Rol">
                <button
                  type="button"
                  onClick={() => setRoleFilter('all')}
                  aria-pressed={roleFilter === 'all'}
                  className={`segmented-item ${roleFilter === 'all' ? 'segmented-item-active' : ''}`}
                >
                  Hammasi <span className="tabular ml-1 opacity-70">{users.length}</span>
                </button>
                {roleFilters.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setRoleFilter(role)}
                    aria-pressed={roleFilter === role}
                    className={`segmented-item ${roleFilter === role ? 'segmented-item-active' : ''}`}
                  >
                    {roleLabels[role]} <span className="tabular ml-1 opacity-70">{roleCounts.get(role)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </PageHeader>

      {(error || success || amocrmManagersQuery.error || telegramRecipientsQuery.error || createdCredentials) && (
        <div className="space-y-3">
          {error && <p className="alert alert-error">{error}</p>}
          {success && <p className="alert alert-success">{success}</p>}
          {amocrmManagersQuery.error && (
            <p className="alert alert-warning">
              AmoCRM menejerlari topilmadi. Agentlarni bog'lash uchun AmoCRM integratsiyasini ulang.
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

      <section className="panel min-w-0 overflow-hidden">
        <div className="panel-header pb-4 sm:pb-4">
          <div className="flex items-center gap-2">
            <h2 className="section-title">Ish maydoni foydalanuvchilari</h2>
            {users.length > 0 && <span className="badge badge-neutral tabular">{users.length}</span>}
          </div>
        </div>

        {usersQuery.isLoading ? (
          <LoadingBlock message="Foydalanuvchilar yuklanmoqda..." className="mx-5 mb-5 sm:mx-6 sm:mb-6" />
        ) : visibleUsers.length ? (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="pl-5 sm:pl-6">Foydalanuvchi</th>
                  <th>Rol</th>
                  <th>Oxirgi kirish</th>
                  <th>Holat</th>
                  <th className="pr-5 text-right sm:pr-6"><span className="sr-only">Amal</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((user) => {
                  const userRoles: string[] = Array.isArray(user.roles) ? user.roles : [];
                  const contact = [user.username, user.phone].filter(Boolean).join(' · ');

                  return (
                    <tr key={user.id}>
                      <td className="pl-5 sm:pl-6">
                        <div className="flex min-w-[220px] items-center gap-3">
                          <UserAvatar name={user.name || user.username || '?'} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-gray-900">{user.name || user.username || user.id}</p>
                            {contact && <p className="tabular truncate text-xs text-gray-500">{contact}</p>}
                            <p className="truncate text-[11px] text-gray-400">ID: {user.id}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          {userRoles.map((role) => (
                            <span key={role} className="badge badge-blue">{roleLabels[role as UserRole] || role}</span>
                          ))}
                        </div>
                      </td>
                      <td className="tabular whitespace-nowrap text-gray-600">
                        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Hech qachon'}
                      </td>
                      <td>
                        <span className={`badge ${user.isActive ? 'badge-green' : 'badge-amber'}`}>
                          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${user.isActive ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                          {user.isActive ? 'Faol' : 'Nofaol'}
                        </span>
                      </td>
                      <td className="pr-5 sm:pr-6">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingUserId(user.id)}
                            className="btn btn-soft btn-sm"
                          >
                            <IconPencil className="h-4 w-4" stroke={1.8} />
                            Tahrirlash
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(user.id, !user.isActive)}
                            disabled={!isAdmin || setActiveMutation.isLoading}
                            className="btn btn-ghost btn-sm"
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={IconUsers} title="Bu ish maydonida foydalanuvchi topilmadi." className="mx-5 mb-5 sm:mx-6 sm:mb-6" />
        )}
      </section>

      {createOpen && (
        <UserCreateSheet
          onClose={() => setCreateOpen(false)}
          onSubmit={handleCreateUser}
          isSubmitting={createUser.isLoading}
          error={error}
          createdCredentials={createdCredentials}
          newName={newName}
          setNewName={setNewName}
          newPhone={newPhone}
          setNewPhone={setNewPhone}
          newRole={newRole}
          setNewRole={setNewRole}
          newAmoManagerId={newAmoManagerId}
          setNewAmoManagerId={setNewAmoManagerId}
          newTelegramChatId={newTelegramChatId}
          setNewTelegramChatId={setNewTelegramChatId}
          amocrmManagers={amocrmManagers}
          telegramRecipients={telegramRecipients}
        />
      )}

      {editingUser && (
        <UserEditSheet
          user={editingUser}
          onClose={() => setEditingUserId(null)}
          error={error}
          success={success}
          generatedPassword={generatedResetPassword && generatedResetPassword.userId === editingUser.id ? generatedResetPassword.password : null}
          nameDrafts={nameDrafts}
          setNameDrafts={setNameDrafts}
          phoneDrafts={phoneDrafts}
          setPhoneDrafts={setPhoneDrafts}
          loginDrafts={loginDrafts}
          setLoginDrafts={setLoginDrafts}
          passwordDrafts={passwordDrafts}
          setPasswordDrafts={setPasswordDrafts}
          roleDrafts={roleDrafts}
          setRoleDrafts={setRoleDrafts}
          managerDrafts={managerDrafts}
          setManagerDrafts={setManagerDrafts}
          telegramDrafts={telegramDrafts}
          setTelegramDrafts={setTelegramDrafts}
          amocrmManagers={amocrmManagers}
          telegramRecipients={telegramRecipients}
          isSavingName={updateName.isLoading}
          onSaveName={handleNameSave}
          onGeneratePassword={handleGeneratePassword}
          onSaveCredentials={handleCredentialsSave}
          onSaveRole={handleRoleSave}
        />
      )}
    </div>
  );
}
