'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';

type RecipientRole = 'all' | 'Admin' | 'Manager' | 'TeamLeader' | 'Agent' | 'Finance' | 'Tashkiliy';

const roleOptions: Array<{ value: RecipientRole; label: string }> = [
  { value: 'all', label: 'Barcha rollar' },
  { value: 'Admin', label: 'Admin' },
  { value: 'Manager', label: 'Menejer' },
  { value: 'TeamLeader', label: 'Team lider' },
  { value: 'Agent', label: 'Agent' },
  { value: 'Finance', label: 'Moliya' },
  { value: 'Tashkiliy', label: 'Tashkiliy' },
];

function resolveUserLabel(user: any): string {
  return user.name || user.username || user.email || user.phone || 'Foydalanuvchi';
}

export default function TelegramBotPage() {
  const recipientsQuery = trpc.telegramBot.recipients.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const sendMessageMutation = trpc.telegramBot.sendMessage.useMutation();

  const [selectedRole, setSelectedRole] = useState<RecipientRole>('all');
  const [search, setSearch] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const allUsers = useMemo(() => recipientsQuery.data?.users || [], [recipientsQuery.data]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allUsers.filter((user: any) => {
      if (!user.canSend) {
        return false;
      }
      if (selectedRole !== 'all' && !user.roles?.includes(selectedRole)) {
        return false;
      }
      if (!query) {
        return true;
      }
      const label = resolveUserLabel(user).toLowerCase();
      const tgName = String(user.telegramDisplayName || '').toLowerCase();
      const tgUser = String(user.telegramUsername || '').toLowerCase();
      return label.includes(query) || tgName.includes(query) || tgUser.includes(query);
    });
  }, [allUsers, search, selectedRole]);

  const selectedSet = useMemo(() => new Set(selectedUserIds), [selectedUserIds]);

  const allFilteredSelected = filteredUsers.length > 0 && filteredUsers.every((user: any) => selectedSet.has(user.id));

  const toggleAllFiltered = () => {
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredUsers.map((user: any) => user.id));
      setSelectedUserIds((prev) => prev.filter((id) => !filteredSet.has(id)));
      return;
    }

    setSelectedUserIds((prev) => {
      const merged = new Set(prev);
      for (const user of filteredUsers) {
        merged.add(user.id);
      }
      return Array.from(merged);
    });
  };

  const toggleUser = (userId: string) => {
    setSelectedUserIds((prev) => (
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    ));
  };

  const handleSend = async () => {
    setError(null);
    setSuccess(null);

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setError('Xabar matnini kiriting.');
      return;
    }
    if (selectedUserIds.length === 0) {
      setError("Kamida bitta foydalanuvchini tanlang.");
      return;
    }

    try {
      const result = await sendMessageMutation.mutateAsync({
        userIds: selectedUserIds,
        text: trimmedMessage,
      });

      const failedCount = result.failed?.length || 0;
      if (failedCount > 0) {
        setSuccess(`Yuborildi: ${result.delivered}/${result.targetUsers}. Xatolik: ${failedCount}.`);
      } else {
        setSuccess(`Xabar muvaffaqiyatli yuborildi (${result.delivered} ta foydalanuvchi).`);
      }
      setMessage('');
    } catch (mutationError: any) {
      setError(mutationError?.message || "Xabar yuborishda xatolik yuz berdi.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white shadow dark:bg-slate-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Telegram bot</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            Foydalanuvchilarga Telegram orqali xabar yuborish. Faqat bog&apos;langan akkauntlar chiqadi.
          </p>
        </div>

        <div className="space-y-4 p-6">
          {!recipientsQuery.data?.connected && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              Telegram integratsiyasi ulanmagan. Avval Integratsiyalar bo&apos;limida Telegram botni ulang.
            </p>
          )}
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </p>
          )}
          {success && (
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">
              {success}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr_auto]">
            <select
              value={selectedRole}
              onChange={(event) => setSelectedRole(event.target.value as RecipientRole)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              {roleOptions.map((roleOption) => (
                <option key={roleOption.value} value={roleOption.value}>
                  {roleOption.label}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Ism, login yoki telegram bo'yicha qidirish"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={toggleAllFiltered}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {allFilteredSelected ? 'Tanlovni bekor qilish' : 'Filtrdagini tanlash'}
            </button>
          </div>

          <div className="rounded-md border border-gray-200 dark:border-slate-700">
            <div className="max-h-80 overflow-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Tanlash</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Foydalanuvchi</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Rol</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Telegram</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
                  {filteredUsers.map((user: any) => (
                    <tr key={user.id}>
                      <td className="px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(user.id)}
                          onChange={() => toggleUser(user.id)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">
                        {resolveUserLabel(user)}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">
                        {Array.isArray(user.roles) ? user.roles.join(', ') : '-'}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">
                        {user.telegramDisplayName || user.telegramChatId || '-'}
                        {user.telegramUsername ? ` (@${user.telegramUsername})` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredUsers.length === 0 && (
              <p className="px-3 py-3 text-sm text-gray-500 dark:text-slate-400">
                Filtr bo&apos;yicha Telegram bog&apos;langan foydalanuvchi topilmadi.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Xabar matni</label>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
              placeholder="Yuboriladigan xabarni kiriting..."
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-600 dark:text-slate-400">
              Tanlangan foydalanuvchilar: <span className="font-medium">{selectedUserIds.length}</span>
            </p>
            <button
              type="button"
              onClick={handleSend}
              disabled={sendMessageMutation.isLoading || selectedUserIds.length === 0}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sendMessageMutation.isLoading ? 'Yuborilmoqda...' : 'Telegramga yuborish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
