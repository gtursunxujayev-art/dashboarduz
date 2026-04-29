'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

function getTodayTashkentDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function getNowTashkentDateTimeLocal(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function formatSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hh = Math.floor(safe / 3600);
  const mm = Math.floor((safe % 3600) / 60);
  const ss = safe % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
}

function hasInPresence(row: any): boolean {
  if (!row) return false;
  if (row.firstInAt) return true;
  return typeof row.inCount === 'number' && row.inCount > 0;
}

function getPresenceLabel(row: any): string {
  return hasInPresence(row) ? 'Kelgan (IN bor)' : "Kelmagan (IN yo'q)";
}

export default function AttendancePage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const isAdmin = roles.includes('Admin');
  const canReadAnomalies = roles.includes('Admin') || roles.includes('Manager') || roles.includes('TeamLeader');

  const today = useMemo(() => getTodayTashkentDate(), []);
  const nowDateTime = useMemo(() => getNowTashkentDateTimeLocal(), []);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [query, setQuery] = useState('');
  const [anomaliesOnly, setAnomaliesOnly] = useState(false);
  const [correctionAction, setCorrectionAction] = useState<'add_missing_out' | 'edit_event_time' | 'mark_justified_absence'>('add_missing_out');
  const [correctionUserId, setCorrectionUserId] = useState('');
  const [correctionEventId, setCorrectionEventId] = useState('');
  const [correctionTimestamp, setCorrectionTimestamp] = useState(nowDateTime);
  const [correctionSummaryDate, setCorrectionSummaryDate] = useState(today);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionSuccess, setCorrectionSuccess] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  const usersQuery = trpc.users.list.useQuery(undefined, {
    enabled: isAdmin,
    retry: false,
  });

  const summariesQuery = trpc.attendance.listDailySummaries.useQuery(
    {
      page: 1,
      limit: 100,
      dateFrom,
      dateTo,
      query: query || undefined,
      anomaliesOnly,
    },
    {
      keepPreviousData: true,
    },
  );

  const eventsQuery = trpc.attendance.listEvents.useQuery(
    {
      page: 1,
      limit: 50,
      dateFrom,
      dateTo,
      query: query || undefined,
    },
    {
      keepPreviousData: true,
    },
  );

  const anomaliesQuery = trpc.attendance.listAnomalies.useQuery(
    {
      dateFrom,
      dateTo,
      limit: 40,
    },
    {
      enabled: canReadAnomalies,
      retry: false,
    },
  );

  const recomputeMutation = trpc.attendance.recomputeRange.useMutation({
    onSuccess: async () => {
      await Promise.all([
        summariesQuery.refetch(),
        eventsQuery.refetch(),
        canReadAnomalies ? anomaliesQuery.refetch() : Promise.resolve(),
      ]);
    },
  });

  const correctionMutation = trpc.attendance.applyCorrection.useMutation({
    onSuccess: async () => {
      setCorrectionSuccess("Tuzatish muvaffaqiyatli saqlandi.");
      setCorrectionError(null);
      await Promise.all([
        summariesQuery.refetch(),
        eventsQuery.refetch(),
        canReadAnomalies ? anomaliesQuery.refetch() : Promise.resolve(),
      ]);
    },
    onError: (error) => {
      setCorrectionSuccess(null);
      setCorrectionError(error.message || "Tuzatishni saqlashda xatolik.");
    },
  });

  const totals = useMemo(() => {
    const rows = summariesQuery.data?.rows || [];
    return rows.reduce(
      (acc, row: any) => {
        acc.workedSeconds += row.workedSeconds || 0;
        acc.requiredSeconds += row.requiredSeconds || 0;
        acc.missingSeconds += row.missingSeconds || 0;
        acc.lateMinutes += row.lateMinutes || 0;
        acc.absenceDays += row.absence ? 1 : 0;
        acc.anomalies += row.anomalyCount || 0;
        return acc;
      },
      {
        workedSeconds: 0,
        requiredSeconds: 0,
        missingSeconds: 0,
        lateMinutes: 0,
        absenceDays: 0,
        anomalies: 0,
      },
    );
  }, [summariesQuery.data?.rows]);

  const presenceByUserDate = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const row of summariesQuery.data?.rows || []) {
      const key = `${row.userId || ''}|${row.summaryDate || ''}`;
      map.set(key, hasInPresence(row));
    }
    return map;
  }, [summariesQuery.data?.rows]);

  const userOptions = useMemo(
    () =>
      (usersQuery.data || [])
        .filter((currentUser: any) => Array.isArray(currentUser.roles) && currentUser.isActive !== false)
        .map((currentUser: any) => ({
          id: currentUser.id as string,
          label: (currentUser.name as string | null) || (currentUser.username as string | null) || currentUser.id,
        })),
    [usersQuery.data],
  );

  const eventOptions = useMemo(
    () =>
      (eventsQuery.data?.rows || [])
        .filter((row: any) => typeof row.id === 'string')
        .map((row: any) => ({
          id: row.id as string,
          label: `${row.localDate || '-'} | ${row.action || '-'} | ${(row.user?.name as string) || `${row.firstName || ''} ${row.lastName || ''}`.trim() || '-'} | ${formatDateTime(row.eventAt)}`,
        })),
    [eventsQuery.data?.rows],
  );

  const handleApplyCorrection = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isAdmin) return;
    setCorrectionSuccess(null);
    setCorrectionError(null);

    const reason = correctionReason.trim();
    if (!reason) {
      setCorrectionError('Izoh majburiy.');
      return;
    }

    try {
      if (correctionAction === 'add_missing_out') {
        if (!correctionUserId) {
          setCorrectionError("Xodimni tanlang.");
          return;
        }
        await correctionMutation.mutateAsync({
          action: 'add_missing_out',
          userId: correctionUserId,
          timestamp: new Date(correctionTimestamp).toISOString(),
          reason,
        });
        return;
      }

      if (correctionAction === 'edit_event_time') {
        if (!correctionEventId) {
          setCorrectionError('Event tanlanmagan.');
          return;
        }
        await correctionMutation.mutateAsync({
          action: 'edit_event_time',
          eventId: correctionEventId,
          timestamp: new Date(correctionTimestamp).toISOString(),
          reason,
        });
        return;
      }

      if (!correctionUserId) {
        setCorrectionError("Xodimni tanlang.");
        return;
      }
      await correctionMutation.mutateAsync({
        action: 'mark_justified_absence',
        userId: correctionUserId,
        summaryDate: correctionSummaryDate,
        reason,
      });
    } catch {
      // handled by mutation onError
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white shadow dark:bg-slate-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Davomat</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            Face ID orqali kelgan IN/OUT yozuvlari, kunlik ishlangan vaqt va kechikishlar.
          </p>
        </div>

        <div className="space-y-5 p-6">
          <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <div className="space-y-1">
                <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Boshlanish</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Tugash</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Qidiruv</label>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Ism, username yoki telefon"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={anomaliesOnly}
                    onChange={(event) => setAnomaliesOnly(event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Faqat anomaliya
                </label>
              </div>
              {isAdmin ? (
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => recomputeMutation.mutate({ dateFrom, dateTo })}
                    disabled={recomputeMutation.isLoading}
                    className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {recomputeMutation.isLoading ? 'Qayta hisoblanmoqda...' : 'Davomatni qayta hisoblash'}
                  </button>
                </div>
              ) : (
                <div />
              )}
            </div>
            {recomputeMutation.error && (
              <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
                {recomputeMutation.error.message}
              </p>
            )}
          </div>

          {isAdmin && (
            <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Admin tuzatishlari</h3>
              <form onSubmit={handleApplyCorrection} className="space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Amal</label>
                    <select
                      value={correctionAction}
                      onChange={(event) => setCorrectionAction(event.target.value as 'add_missing_out' | 'edit_event_time' | 'mark_justified_absence')}
                      className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="add_missing_out">Missing OUT qo'shish</option>
                      <option value="edit_event_time">Event vaqtini tahrirlash</option>
                      <option value="mark_justified_absence">Kelmagan kunni oqlash</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Xodim</label>
                    <select
                      value={correctionUserId}
                      onChange={(event) => setCorrectionUserId(event.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="">Xodim tanlang</option>
                      {userOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  {correctionAction === 'edit_event_time' ? (
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Event</label>
                      <select
                        value={correctionEventId}
                        onChange={(event) => setCorrectionEventId(event.target.value)}
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      >
                        <option value="">Event tanlang</option>
                        {eventOptions.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  ) : correctionAction === 'mark_justified_absence' ? (
                    <div>
                      <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Sana</label>
                      <input
                        type="date"
                        value={correctionSummaryDate}
                        onChange={(event) => setCorrectionSummaryDate(event.target.value)}
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">OUT vaqti</label>
                      <input
                        type="datetime-local"
                        value={correctionTimestamp}
                        onChange={(event) => setCorrectionTimestamp(event.target.value)}
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                  {correctionAction === 'edit_event_time' && (
                    <div>
                      <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Yangi vaqt</label>
                      <input
                        type="datetime-local"
                        value={correctionTimestamp}
                        onChange={(event) => setCorrectionTimestamp(event.target.value)}
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
                  <textarea
                    value={correctionReason}
                    onChange={(event) => setCorrectionReason(event.target.value)}
                    placeholder="Tuzatish sababi (majburiy)"
                    rows={2}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={correctionMutation.isLoading}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {correctionMutation.isLoading ? 'Saqlanmoqda...' : 'Tuzatishni saqlash'}
                  </button>
                </div>
                {correctionSuccess && (
                  <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">{correctionSuccess}</p>
                )}
                {correctionError && (
                  <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{correctionError}</p>
                )}
                {usersQuery.error && (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                    Xodimlar ro&apos;yxatini yuklashda xatolik: {usersQuery.error.message}
                  </p>
                )}
              </form>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700">
              <p className="text-xs uppercase text-gray-500 dark:text-slate-400">Ishlangan vaqt</p>
              <p className="text-base font-semibold text-gray-900 dark:text-slate-100">{formatSeconds(totals.workedSeconds)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700">
              <p className="text-xs uppercase text-gray-500 dark:text-slate-400">Talab vaqt</p>
              <p className="text-base font-semibold text-gray-900 dark:text-slate-100">{formatSeconds(totals.requiredSeconds)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700">
              <p className="text-xs uppercase text-gray-500 dark:text-slate-400">Yetishmaydi</p>
              <p className="text-base font-semibold text-gray-900 dark:text-slate-100">{formatSeconds(totals.missingSeconds)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700">
              <p className="text-xs uppercase text-gray-500 dark:text-slate-400">Kechikish (daq)</p>
              <p className="text-base font-semibold text-gray-900 dark:text-slate-100">{totals.lateMinutes}</p>
            </div>
            <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700">
              <p className="text-xs uppercase text-gray-500 dark:text-slate-400">Kelmagan kun</p>
              <p className="text-base font-semibold text-gray-900 dark:text-slate-100">{totals.absenceDays}</p>
            </div>
            <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700">
              <p className="text-xs uppercase text-gray-500 dark:text-slate-400">Anomaliya</p>
              <p className="text-base font-semibold text-gray-900 dark:text-slate-100">{totals.anomalies}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-slate-700">
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Sana</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Xodim</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Ishlangan</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Yetishmaydi</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Kechikish</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">IN</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">OUT</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Davomat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
                  {(summariesQuery.data?.rows || []).map((row: any) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{row.summaryDate}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{row.user?.name || row.user?.username || row.userId}</td>
                      <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-slate-100">{formatSeconds(row.workedSeconds)}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{formatSeconds(row.missingSeconds)}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{row.lateMinutes || 0} daq</td>
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{formatDateTime(row.firstInAt)}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{formatDateTime(row.lastOutAt)}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{getPresenceLabel(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {summariesQuery.isLoading ? (
              <p className="px-3 py-3 text-sm text-gray-500 dark:text-slate-400">Yuklanmoqda...</p>
            ) : summariesQuery.error ? (
              <p className="px-3 py-3 text-sm text-red-600 dark:text-red-400">{summariesQuery.error.message}</p>
            ) : (summariesQuery.data?.rows || []).length === 0 ? (
              <p className="px-3 py-3 text-sm text-gray-500 dark:text-slate-400">Bu filtr uchun davomat yo&apos;q.</p>
            ) : null}
          </div>

          {canReadAnomalies && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Kunlik anomaliyalar</h3>
                <div className="max-h-52 space-y-2 overflow-auto">
                  {(anomaliesQuery.data?.summaryAnomalies || []).map((row: any) => (
                    <div key={row.id} className="rounded-md border border-amber-300/40 bg-amber-50/40 px-3 py-2 text-sm dark:border-amber-800/50 dark:bg-amber-950/20">
                      <p className="font-medium text-gray-900 dark:text-slate-100">{row.user?.name || row.user?.username || row.userId}</p>
                      <p className="text-gray-700 dark:text-slate-300">
                        {row.summaryDate} | anomaliya: {row.anomalyCount || 0} |{' '}
                        {presenceByUserDate.get(`${row.userId || ''}|${row.summaryDate || ''}`) ? 'Kelgan (IN bor)' : "Kelmagan (IN yo'q)"}
                      </p>
                    </div>
                  ))}
                  {anomaliesQuery.isLoading && <p className="text-sm text-gray-500 dark:text-slate-400">Yuklanmoqda...</p>}
                  {!anomaliesQuery.isLoading && (anomaliesQuery.data?.summaryAnomalies || []).length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-slate-400">Anomaliya topilmadi.</p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Bog&apos;lanmagan eventlar</h3>
                <div className="max-h-52 space-y-2 overflow-auto">
                  {(anomaliesQuery.data?.unmatchedEvents || []).map((row: any) => (
                    <div key={row.id} className="rounded-md border border-red-300/40 bg-red-50/40 px-3 py-2 text-sm dark:border-red-800/50 dark:bg-red-950/20">
                      <p className="font-medium text-gray-900 dark:text-slate-100">
                        {(row.firstName || '')} {(row.lastName || '')} ({row.externalPhone || '-'})
                      </p>
                      <p className="text-gray-700 dark:text-slate-300">
                        {row.localDate} | {row.action} | {formatDateTime(row.eventAt)}
                      </p>
                      <p className="text-xs text-red-700 dark:text-red-300">
                        Sabab: {row.matchReason || 'unknown'} | Qadam: {row.matchStepTried || 'unknown'}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-slate-300">
                        Raw user: ID={row.rawUser?.id ?? '-'}, name={(row.rawUser?.first_name || '')} {(row.rawUser?.last_name || '')}, phone={row.rawUser?.phone_number || '-'}
                      </p>
                    </div>
                  ))}
                  {anomaliesQuery.isLoading && <p className="text-sm text-gray-500 dark:text-slate-400">Yuklanmoqda...</p>}
                  {!anomaliesQuery.isLoading && (anomaliesQuery.data?.unmatchedEvents || []).length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-slate-400">Bog&apos;lanmagan event yo&apos;q.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Oxirgi eventlar</h3>
            <div className="max-h-56 overflow-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Vaqt</th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Harakat</th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Xodim</th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Branch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
                  {(eventsQuery.data?.rows || []).map((row: any) => (
                    <tr key={row.id}>
                      <td className="px-2 py-2 text-xs text-gray-700 dark:text-slate-300">{formatDateTime(row.eventAt)}</td>
                      <td className="px-2 py-2 text-xs text-gray-700 dark:text-slate-300">{row.action}</td>
                      <td className="px-2 py-2 text-xs text-gray-700 dark:text-slate-300">{row.user?.name || `${row.firstName || ''} ${row.lastName || ''}`.trim() || '-'}</td>
                      <td className="px-2 py-2 text-xs text-gray-700 dark:text-slate-300">{row.branchName || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {eventsQuery.isLoading ? (
              <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">Yuklanmoqda...</p>
            ) : eventsQuery.error ? (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{eventsQuery.error.message}</p>
            ) : (eventsQuery.data?.rows || []).length === 0 ? (
              <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">Event topilmadi.</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
