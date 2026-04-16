'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';

function getTashkentDate(offsetDays = 0): string {
  const now = new Date();
  const shifted = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(shifted);

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
}

export default function CorporateCallsPage() {
  const today = getTashkentDate(0);
  const yesterday = getTashkentDate(-1);

  const [formManagerUserId, setFormManagerUserId] = useState('');
  const [formDate, setFormDate] = useState(today);
  const [formDuration, setFormDuration] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [listFrom, setListFrom] = useState(getTashkentDate(-7));
  const [listTo, setListTo] = useState(today);
  const [listManagerUserId, setListManagerUserId] = useState('');

  const optionsQuery = trpc.corporateCalls.getFormOptions.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const canChooseCustomDate = optionsQuery.data?.canChooseCustomDate ?? false;
  const managers = optionsQuery.data?.managers ?? [];

  const listQuery = trpc.corporateCalls.list.useQuery({
    managerUserId: canChooseCustomDate ? (listManagerUserId || undefined) : undefined,
    dateFrom: listFrom,
    dateTo: listTo,
    limit: 120,
  }, {
    enabled: Boolean(optionsQuery.data),
    keepPreviousData: true,
  });

  const upsertMutation = trpc.corporateCalls.upsert.useMutation({
    onSuccess: async () => {
      setFormDuration('');
      setSuccessMessage("Korporativ qo'ng'iroq davomiyligi saqlandi.");
      await listQuery.refetch();
    },
  });

  useEffect(() => {
    if (managers.length === 0) return;
    if (!formManagerUserId) {
      setFormManagerUserId(managers[0].id);
    }
    if (!listManagerUserId) {
      setListManagerUserId(managers[0].id);
    }
  }, [managers, formManagerUserId, listManagerUserId]);

  useEffect(() => {
    if (!canChooseCustomDate) {
      if (formDate !== today && formDate !== yesterday) {
        setFormDate(today);
      }
      setListFrom(yesterday);
      setListTo(today);
    }
  }, [canChooseCustomDate, formDate, today, yesterday]);

  const rows = useMemo(() => listQuery.data?.rows ?? [], [listQuery.data]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSuccessMessage(null);

    if (!formDuration.trim()) {
      return;
    }

    await upsertMutation.mutateAsync({
      managerUserId: canChooseCustomDate ? (formManagerUserId || undefined) : undefined,
      date: formDate,
      duration: formDuration.trim(),
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white shadow dark:bg-slate-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Korporativ qo&apos;ng&apos;iroq</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            Qo&apos;ng&apos;iroq davomiyligini qo&apos;lda kiriting. Bu ma&apos;lumotlar dashboard, sotuvchilar va hisobotlarda umumiy call duration&apos;ga qo&apos;shiladi.
          </p>
        </div>

        <div className="space-y-5 p-6">
          {successMessage && (
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">
              {successMessage}
            </p>
          )}
          {upsertMutation.error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
              {upsertMutation.error.message}
            </p>
          )}

          <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Menejer</label>
                <select
                  value={formManagerUserId}
                  onChange={(event) => setFormManagerUserId(event.target.value)}
                  disabled={!canChooseCustomDate}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  {managers.map((manager: any) => (
                    <option key={manager.id} value={manager.id}>{manager.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Sana</label>
                {canChooseCustomDate ? (
                  <input
                    type="date"
                    value={formDate}
                    onChange={(event) => setFormDate(event.target.value)}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                ) : (
                  <select
                    value={formDate}
                    onChange={(event) => setFormDate(event.target.value)}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value={today}>Bugun ({today})</option>
                    <option value={yesterday}>Kecha ({yesterday})</option>
                  </select>
                )}
              </div>

              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Davomiylik</label>
                <input
                  value={formDuration}
                  onChange={(event) => setFormDuration(event.target.value)}
                  placeholder="HH:MM:SS yoki HH:MM"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={upsertMutation.isLoading || managers.length === 0}
                  className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {upsertMutation.isLoading ? 'Saqlanmoqda...' : 'Saqlash'}
                </button>
              </div>
            </div>

            {!canChooseCustomDate && (
              <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                Menejerlar faqat bugun yoki kecha sanasiga qo&apos;lda qo&apos;ng&apos;iroq davomiyligi kiritishi mumkin.
              </p>
            )}
          </form>

          <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Ro&apos;yxat: Boshlanish</label>
                <input
                  type="date"
                  value={listFrom}
                  onChange={(event) => setListFrom(event.target.value)}
                  disabled={!canChooseCustomDate}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Ro&apos;yxat: Tugash</label>
                <input
                  type="date"
                  value={listTo}
                  onChange={(event) => setListTo(event.target.value)}
                  disabled={!canChooseCustomDate}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Menejer filtri</label>
                <select
                  value={listManagerUserId}
                  onChange={(event) => setListManagerUserId(event.target.value)}
                  disabled={!canChooseCustomDate}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  {managers.map((manager: any) => (
                    <option key={manager.id} value={manager.id}>{manager.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => listQuery.refetch()}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Yangilash
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-slate-700">
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Sana</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Menejer</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Davomiylik</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Kiritilgan vaqt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
                  {rows.map((row: any) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{row.date}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{row.managerName}</td>
                      <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-slate-100">{row.duration}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{formatDateTime(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {listQuery.isLoading ? (
              <p className="px-3 py-3 text-sm text-gray-500 dark:text-slate-400">Yuklanmoqda...</p>
            ) : listQuery.error ? (
              <p className="px-3 py-3 text-sm text-red-600 dark:text-red-400">{listQuery.error.message}</p>
            ) : rows.length === 0 ? (
              <p className="px-3 py-3 text-sm text-gray-500 dark:text-slate-400">Hozircha ma&apos;lumot yo&apos;q.</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

