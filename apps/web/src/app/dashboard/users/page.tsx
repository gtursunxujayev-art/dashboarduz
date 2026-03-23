'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';

const availableRoles = ['Admin', 'Manager', 'Agent', 'Finance', 'Tashkiliy'] as const;
const roleLabels: Record<(typeof availableRoles)[number], string> = {
  Admin: 'Admin',
  Manager: 'Menejer',
  Agent: 'Agent',
  Finance: 'Moliya',
  Tashkiliy: 'Tashkiliy',
};

type UserRole = (typeof availableRoles)[number];

export default function UsersPage() {
  const usersQuery = trpc.users.list.useQuery();
  const amocrmManagersQuery = trpc.users.amocrmManagers.useQuery(undefined, {
    retry: false,
  });
  const utelManagersQuery = trpc.users.utelManagers.useQuery(undefined, {
    retry: false,
  });
  const createUser = trpc.users.create.useMutation();
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

  const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>({});
  const [managerDrafts, setManagerDrafts] = useState<Record<string, string>>({});
  const [utelDrafts, setUtelDrafts] = useState<Record<string, string>>({});
  const [loginDrafts, setLoginDrafts] = useState<Record<string, string>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});

  const amocrmManagers = useMemo(() => amocrmManagersQuery.data || [], [amocrmManagersQuery.data]);
  const utelManagers = useMemo(() => utelManagersQuery.data || [], [utelManagersQuery.data]);

  useEffect(() => {
    const users = usersQuery.data || [];
    const nextRoleDrafts: Record<string, UserRole> = {};
    const nextManagerDrafts: Record<string, string> = {};
    const nextUtelDrafts: Record<string, string> = {};
    const nextLoginDrafts: Record<string, string> = {};

    for (const user of users as any[]) {
      nextRoleDrafts[user.id] = (user.roles?.[0] || 'Agent') as UserRole;
      nextManagerDrafts[user.id] = user.amocrmResponsibleUserId || '';
      nextUtelDrafts[user.id] = user.utelManagerExternalId || '';
      nextLoginDrafts[user.id] = user.username || '';
    }

    setRoleDrafts(nextRoleDrafts);
    setManagerDrafts(nextManagerDrafts);
    setUtelDrafts(nextUtelDrafts);
    setLoginDrafts(nextLoginDrafts);
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
        amocrmResponsibleUserId: newRole === 'Agent' ? (newAmoManagerId || undefined) : undefined,
        utelManagerExternalId: newRole === 'Agent' ? (newUtelManagerId || undefined) : undefined,
      });

      setCreatedCredentials(created.credentials);
      setNewName('');
      setNewRole('Agent');
      setNewAmoManagerId('');
      setNewUtelManagerId('');
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
        amocrmResponsibleUserId: (roleDrafts[userId] || 'Agent') === 'Agent'
          ? (managerDrafts[userId] || undefined)
          : undefined,
        utelManagerExternalId: (roleDrafts[userId] || 'Agent') === 'Agent'
          ? (utelDrafts[userId] || undefined)
          : undefined,
      });
      setSuccess("Foydalanuvchi roli va menejer bog'lanishi saqlandi.");
      await usersQuery.refetch();
    } catch (mutationError: any) {
      setError(mutationError?.message || "Rolni yangilashda xatolik");
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
          {createdCredentials && (
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
              Foydalanuvchi yaratildi. Login: <strong>{createdCredentials.login}</strong>, Parol: <strong>{createdCredentials.password}</strong>
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_160px_1fr_1fr_auto]">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Foydalanuvchi ismi (ixtiyoriy)"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <select
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as UserRole)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              disabled={newRole !== 'Agent'}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
            >
              <option value="">{newRole === 'Agent' ? 'AmoCRM menejerini tanlang' : 'Bu rol uchun shart emas'}</option>
              {amocrmManagers.map((manager: any) => (
                <option key={manager.id} value={manager.id}>
                  {manager.name}
                </option>
              ))}
            </select>
            <select
              value={newUtelManagerId}
              onChange={(event) => setNewUtelManagerId(event.target.value)}
              disabled={newRole !== 'Agent'}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
            >
              <option value="">{newRole === 'Agent' ? 'UTeL menejerini tanlang' : 'Bu rol uchun shart emas'}</option>
              {utelManagers.map((manager: any) => (
                <option key={manager.id} value={manager.id}>
                  {manager.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleCreateUser}
              disabled={createUser.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Rol + CRM/UTeL menejer</th>
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
                        {user.name || user.email || user.phone || 'Foydalanuvchi'}
                        <div className="text-xs text-gray-500">ID: {user.id}</div>
                      </td>
                      <td className="space-y-2 px-4 py-3 text-sm text-gray-700">
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-[140px_1fr_1fr_auto]">
                          <select
                            value={roleDrafts[user.id] || 'Agent'}
                            onChange={(event) =>
                              setRoleDrafts((prev) => ({ ...prev, [user.id]: event.target.value as UserRole }))
                            }
                            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
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
                            disabled={(roleDrafts[user.id] || 'Agent') !== 'Agent'}
                            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                          >
                            <option value="">
                              {(roleDrafts[user.id] || 'Agent') === 'Agent'
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
                            disabled={(roleDrafts[user.id] || 'Agent') !== 'Agent'}
                            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                          >
                            <option value="">
                              {(roleDrafts[user.id] || 'Agent') === 'Agent'
                                ? 'UTeL menejerini tanlang'
                                : 'Bu rol uchun shart emas'}
                            </option>
                            {utelManagers.map((manager: any) => (
                              <option key={manager.id} value={manager.id}>
                                {manager.name}
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
