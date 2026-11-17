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

  const selectedUsers = allUsers.filter((user: any) => selectedSet.has(user.id));
  const previewText = message.trim();

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

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="panel min-w-0 overflow-hidden">
          <div className="space-y-3 border-b border-gray-100 p-4 sm:p-5">
            <div className="-mx-1 overflow-x-auto px-1 py-1">
              <div className="segmented" role="group" aria-label="Rol">
                {roleOptions.map((roleOption) => (
                  <button
                    key={roleOption.value}
                    type="button"
                    onClick={() => setSelectedRole(roleOption.value)}
                    aria-pressed={selectedRole === roleOption.value}
                    className={`segmented-item ${selectedRole === roleOption.value ? 'segmented-item-active' : ''}`}
                  >
                    {roleOption.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Ism, login yoki telegram bo'yicha qidirish"
                  aria-label="Ism, login yoki telegram bo'yicha qidirish"
                  className="field rounded-full pl-10"
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
          </div>

          <div className="max-h-[600px] overflow-auto">
            <table className="data-table">
              <thead className="sticky top-0 z-[1] bg-white">
                <tr>
                  <th className="w-20 pl-5">Tanlash</th>
                  <th>Foydalanuvchi</th>
                  <th>Rol</th>
                  <th className="pr-5">Telegram</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user: any) => {
                  const selected = selectedSet.has(user.id);
                  const checkboxId = `telegram-recipient-${user.id}`;
                  return (
                    <tr key={user.id} className={selected ? 'bg-blue-50/60' : ''}>
                      <td className="pl-5">
                        <input
                          id={checkboxId}
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleUser(user.id)}
                          className="checkbox"
                        />
                      </td>
                      <td className="whitespace-nowrap">
                        <label htmlFor={checkboxId} className="flex cursor-pointer items-center gap-3">
                          <UserAvatar name={resolveUserLabel(user)} size="sm" />
                          <span className="font-medium text-gray-900">{resolveUserLabel(user)}</span>
                        </label>
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
                      <td className="whitespace-nowrap pr-5 text-gray-600">
                        <span className="inline-flex items-center gap-1.5">
                          <IconBrandTelegram className="h-4 w-4 text-sky-500" stroke={1.8} aria-hidden="true" />
                          <span>
                            {user.telegramDisplayName || user.telegramChatId || '-'}
                            {user.telegramUsername ? ` (@${user.telegramUsername})` : ''}
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-4">
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
        </section>

        <section className="panel flex flex-col overflow-hidden xl:sticky xl:top-20">
          <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-50 text-sky-600">
              <IconBrandTelegram className="h-5 w-5" stroke={1.6} />
            </span>
            <label htmlFor="telegram-bot-message" className="section-title">Xabar matni</label>
          </div>

          {previewText && (
            <div className="bg-gray-50 px-5 py-5" aria-live="polite">
              <div className="flex items-end gap-2">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-sky-500 text-white">
                  <IconBrandTelegram className="h-4 w-4" stroke={1.8} aria-hidden="true" />
                </span>
                <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-[18px] rounded-bl-[6px] bg-white px-4 py-2.5 text-sm leading-relaxed text-gray-800 shadow-sm">
                  {previewText}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-4 p-5">
            <textarea
              id="telegram-bot-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={7}
              placeholder="Yuboriladigan xabarni kiriting..."
              className="field resize-y"
            />
            <div className="panel-inset flex items-center gap-3 py-3 text-sm text-gray-600">
              {selectedUsers.length > 0 ? (
                <span className="flex -space-x-2" aria-hidden="true">
                  {selectedUsers.slice(0, 4).map((user: any) => (
                    <span key={user.id} className="rounded-full ring-2 ring-gray-50">
                      <UserAvatar name={resolveUserLabel(user)} size="sm" />
                    </span>
                  ))}
                </span>
              ) : (
                <IconUsers className="h-4 w-4 text-gray-400" stroke={1.8} />
              )}
              <p>
                Tanlangan foydalanuvchilar: <span className="tabular font-medium text-gray-900">{selectedUserIds.length}</span>
              </p>
            </div>
          </div>
          <div className="border-t border-gray-100 px-5 py-4">
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
