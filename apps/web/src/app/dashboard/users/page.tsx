'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';

const availableRoles = ['Admin', 'Manager', 'TeamLeader', 'Agent', 'Finance', 'Tashkiliy'] as const;
const roleLabels: Record<(typeof availableRoles)[number], string> = {
  Admin: 'Admin',
  Manager: 'Menejer',
  TeamLeader: 'Team lider',
  Agent: 'Agent',
  Finance: 'Moliya',
  Tashkiliy: 'Tashkiliy',
};

type UserRole = (typeof availableRoles)[number];

function roleNeedsManagerMapping(role: UserRole) {
  return role === 'Agent' || role === 'TeamLeader';
}

export default function UsersPage() {
  const usersQuery = trpc.users.list.useQuery();
  const amocrmManagersQuery = trpc.users.amocrmManagers.useQuery(undefined, {
    retry: false,
  });
  const utelManagersQuery = trpc.users.utelManagers.useQuery(undefined, {
    retry: false,
  });
  const telegramRecipientsQuery = trpc.users.telegramRecipients.useQuery(undefined, {
    retry: false,
  });
  const createUser = trpc.users.create.useMutation();
  const updateName = trpc.users.updateName.useMutation();
  const updateRole = trpc.users.updateRole.useMutation();
  const updateCredentials = trpc.users.updateCredentials.useMutation();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{ login: string; password: string } | null>(null);
  const [generatedResetPassword, setGeneratedResetPassword] = useState<{ userId: string; password: string } | null>(null);

  const [newName, setNewName] = useState('');
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

    for (const user of users as any[]) {
      nextRoleDrafts[user.id] = (user.roles?.[0] || 'Agent') as UserRole;
      nextManagerDrafts[user.id] = user.amocrmResponsibleUserId || '';
      nextUtelDrafts[user.id] = user.utelManagerExternalId || '';
      nextTelegramDrafts[user.id] = user.telegramId || '';
      nextLoginDrafts[user.id] = user.username || '';
      nextNameDrafts[user.id] = user.name || '';
    }

    setRoleDrafts(nextRoleDrafts);
    setManagerDrafts(nextManagerDrafts);
    setUtelDrafts(nextUtelDrafts);
    setTelegramDrafts(nextTelegramDrafts);
    setLoginDrafts(nextLoginDrafts);
    setNameDrafts(nextNameDrafts);
  }, [usersQuery.data]);

  const handleCreateUser = async () => {
    setError(null);
    setSuccess(null);
    setCreatedCredentials(null);
    setGeneratedResetPassword(null);

    try {
      const created = await createUser.mutateAsync({
        name: newName.trim() || undefined,
        role: newRole,
        amocrmResponsibleUserId: roleNeedsManagerMapping(newRole) ? (newAmoManagerId || undefined) : undefined,
        utelManagerExternalId: roleNeedsManagerMapping(newRole) ? (newUtelManagerId || undefined) : undefined,
        telegramChatId: newTelegramChatId || undefined,
      });

      setCreatedCredentials(created.credentials);
      setNewName('');
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

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h1 className="text-xl font-semibold text-gray-900">Foydalanuvchilar</h1>
          <p className="mt-1 text-sm text-gray-500">Foydalanuvchi yarating, agentni AmoCRM/UTeL menejeriga bog'lang va login/parolni boshqaring.</p>
        </div>

        <div className="space-y-4 p-6">
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {success && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}
          {amocrmManagersQuery.error && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
              AmoCRM menejerlari topilmadi. Agentlarni bog'lash uchun AmoCRM integratsiyasini ulang.
            </p>
          )}
          {utelManagersQuery.error && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
              UTeL menejerlari topilmadi. Ro'yxat uchun UTeL qo'ng'iroqlari kelishi kerak.
            </p>
          )}
          {telegramRecipientsQuery.error && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
              Telegram bot foydalanuvchilari topilmadi. Integratsiyalar bo'limida botni ulang va /start yuboring.
            </p>
          )}
          {createdCredentials && (
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
              Foydalanuvchi yaratildi. Login: <strong>{createdCredentials.login}</strong>, Parol: <strong>{createdCredentials.password}</strong>
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Foydalanuvchi ismi (ixtiyoriy)"
              className="min-w-0 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <select
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as UserRole)}
              className="min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              className="min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
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
              className="min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
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
              className="min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              onClick={handleCreateUser}
              disabled={createUser.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 xl:whitespace-nowrap"
            >
              {createUser.isLoading ? 'Yaratilmoqda...' : "Foydalanuvchi qo'shish"}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h2 className="text-lg font-medium text-gray-900">Ish maydoni foydalanuvchilari</h2>
        </div>

        <div className="p-6">
          {usersQuery.isLoading ? (
            <p className="text-sm text-gray-600">Foydalanuvchilar yuklanmoqda...</p>
          ) : usersQuery.data?.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Foydalanuvchi</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Rol + CRM/UTeL/Telegram</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Login/Parol</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Oxirgi kirish</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {(usersQuery.data as any[]).map((user) => {
                    const resetState = generatedResetPassword;
                    const generatedPasswordForRow =
                      resetState && resetState.userId === user.id ? resetState.password : null;

                    return (
                    <tr key={user.id}>
                      <td className="px-4 py-3 text-sm text-gray-800">
                        <div className="space-y-2">
                          <input
                            value={nameDrafts[user.id] || ''}
                            onChange={(event) =>
                              setNameDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))
                            }
                            placeholder="Foydalanuvchi ismi"
                            className="w-full min-w-[220px] rounded-md border border-gray-300 px-2 py-1 text-sm"
                          />
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs text-gray-500">ID: {user.id}</div>
                            <button
                              type="button"
                              onClick={() => handleNameSave(user.id)}
                              disabled={updateName.isLoading}
                              className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              {updateName.isLoading ? 'Saqlanmoqda...' : 'Ismni saqlash'}
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="space-y-2 px-4 py-3 text-sm text-gray-700">
                        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-[130px_1fr_1fr_1fr_auto]">
                          <select
                            value={roleDrafts[user.id] || 'Agent'}
                            onChange={(event) =>
                              setRoleDrafts((prev) => ({ ...prev, [user.id]: event.target.value as UserRole }))
                            }
                            className="min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
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
                            className="min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm disabled:bg-gray-100 disabled:text-gray-500"
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
                            className="min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm disabled:bg-gray-100 disabled:text-gray-500"
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
                            className="min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
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
                            className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Saqlash
                          </button>
                        </div>
                      </td>
                      <td className="space-y-2 px-4 py-3 text-sm text-gray-700">
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
                          <input
                            value={loginDrafts[user.id] || ''}
                            onChange={(event) =>
                              setLoginDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))
                            }
                            placeholder="Login"
                            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                          />
                          <input
                            type="password"
                            value={passwordDrafts[user.id] || ''}
                            onChange={(event) =>
                              setPasswordDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))
                            }
                            placeholder="Yangi parol"
                            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => handleCredentialsSave(user.id)}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Saqlash
                          </button>
                          <button
                            type="button"
                            onClick={() => handleGeneratePassword(user.id)}
                            className="rounded-md bg-blue-50 px-3 py-1 text-sm text-blue-700 hover:bg-blue-100"
                          >
                            Yaratish
                          </button>
                        </div>
                        {generatedPasswordForRow && (
                          <p className="rounded bg-green-50 px-2 py-1 text-xs text-green-700">
                            Yangi yaratilgan parol: <strong>{generatedPasswordForRow}</strong>
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Hech qachon'}
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-600">Bu ish maydonida foydalanuvchi topilmadi.</p>
          )}
        </div>
      </div>
    </div>
  );
}
