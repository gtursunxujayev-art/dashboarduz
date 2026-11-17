'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { UserAvatar } from '@/components/ui/user-avatar';
import { IconBrandTelegram, IconChecks, IconSearch, IconSend, IconSquareMinus, IconUsers } from '@tabler/icons-react';

type RecipientRole = 'all' | 'Admin' | 'Manager' | 'TeamLeader' | 'Agent' | 'OnlineAgent' | 'OfflineAgent' | 'Finance' | 'Tashkiliy';

const roleOptions: Array<{ value: RecipientRole; label: string }> = [
  { value: 'all', label: 'Barcha rollar' },
  { value: 'Admin', label: 'Admin' },
  { value: 'Manager', label: 'Menejer' },
  { value: 'TeamLeader', label: 'Team lider' },
  { value: 'Agent', label: 'Agent' },
  { value: 'OnlineAgent', label: 'Online agent' },
  { value: 'OfflineAgent', label: 'Offline agent' },
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
      <PageHeader
        title="Telegram bot"
        description="Foydalanuvchilarga Telegram orqali xabar yuborish. Faqat bog'langan akkauntlar chiqadi."
      />

      {(!recipientsQuery.data?.connected || error || success) && (
        <div className="space-y-3">
          {!recipientsQuery.data?.connected && (
            <p className="alert alert-warning">
              Telegram integratsiyasi ulanmagan. Avval Integratsiyalar bo&apos;limida Telegram botni ulang.
            </p>
          )}
          {error && (
            <p className="alert alert-error">
              {error}
            </p>
          )}
          {success && (
            <p className="alert alert-success">
              {success}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="panel min-w-0">
          <div className="grid grid-cols-1 gap-3 p-3 sm:p-4 md:grid-cols-[200px_minmax(0,1fr)_auto]">
            <select
              value={selectedRole}
              onChange={(event) => setSelectedRole(event.target.value as RecipientRole)}
              className="field"
            >
              {roleOptions.map((roleOption) => (
                <option key={roleOption.value} value={roleOption.value}>
                  {roleOption.label}
                </option>
              ))}
            </select>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ism, login yoki telegram bo'yicha qidirish"
                className="field pl-9"
              />
            </div>
            <button
              type="button"
              onClick={toggleAllFiltered}
              className={`btn ${allFilteredSelected ? 'btn-secondary' : 'btn-soft'}`}
            >
              {allFilteredSelected ? <IconSquareMinus className="h-4 w-4" stroke={1.8} /> : <IconChecks className="h-4 w-4" stroke={1.8} />}
              {allFilteredSelected ? 'Tanlovni bekor qilish' : 'Filtrdagini tanlash'}
            </button>
          </div>

          <div className="border-t border-gray-100 p-2 sm:p-3">
            <div className="max-h-[560px] overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-20">Tanlash</th>
                    <th>Foydalanuvchi</th>
                    <th>Rol</th>
                    <th>Telegram</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user: any) => {
                    const selected = selectedSet.has(user.id);
                    return (
                      <tr key={user.id} className={selected ? 'bg-blue-50/60' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleUser(user.id)}
                            className="checkbox"
                          />
                        </td>
                        <td className="whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            <UserAvatar name={resolveUserLabel(user)} size="sm" />
                            <span className="font-medium text-gray-900">{resolveUserLabel(user)}</span>
                          </div>
                        </td>
                        <td>
                          {Array.isArray(user.roles) && user.roles.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {user.roles.map((role: string) => (
                                <span key={role} className="badge badge-neutral">{role}</span>
                              ))}
                            </div>
                          ) : Array.isArray(user.roles) ? user.roles.join(', ') : '-'}
                        </td>
                        <td className="whitespace-nowrap text-gray-600">
                          {user.telegramDisplayName || user.telegramChatId || '-'}
                          {user.telegramUsername ? ` (@${user.telegramUsername})` : ''}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-2">
                        <EmptyState
                          icon={IconBrandTelegram}
                          title={"Filtr bo'yicha Telegram bog'langan foydalanuvchi topilmadi."}
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="panel xl:sticky xl:top-6">
          <div className="panel-body space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-sky-50 text-sky-600">
                <IconBrandTelegram className="h-[18px] w-[18px]" stroke={1.8} />
              </span>
              <label htmlFor="telegram-bot-message" className="section-title">Xabar matni</label>
            </div>
            <textarea
              id="telegram-bot-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={8}
              placeholder="Yuboriladigan xabarni kiriting..."
              className="field"
            />
            <div className="panel-inset flex items-center gap-2 py-3 text-sm text-gray-600">
              <IconUsers className="h-4 w-4 text-gray-400" stroke={1.8} />
              <p>
                Tanlangan foydalanuvchilar: <span className="tabular font-medium text-gray-900">{selectedUserIds.length}</span>
              </p>
            </div>
          </div>
          <div className="border-t border-gray-100 px-5 py-4 sm:px-6">
            <button
              type="button"
              onClick={handleSend}
              disabled={sendMessageMutation.isLoading || selectedUserIds.length === 0}
              className="btn btn-primary w-full"
            >
              <IconSend className="h-4 w-4" stroke={1.8} />
              {sendMessageMutation.isLoading ? 'Yuborilmoqda...' : 'Telegramga yuborish'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
