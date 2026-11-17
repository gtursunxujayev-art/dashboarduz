'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { IconClock, IconDeviceFloppy, IconPhoneCall, IconRefresh, IconTrash } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatDateTime, UZ_TASHKENT_DATE_TIME } from '@/lib/format';

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

function normalizeDurationInput(rawValue: string): string {
  const digitsOnly = String(rawValue || '').replace(/\D/g, '').slice(0, 6);
  const hh = digitsOnly.slice(0, 2);
  const mm = digitsOnly.slice(2, 4);
  const ss = digitsOnly.slice(4, 6);

  if (digitsOnly.length <= 2) {
    return hh;
  }
  if (digitsOnly.length <= 4) {
    return `${hh}:${mm}`;
  }
  return `${hh}:${mm}:${ss}`;
}

export default function CorporateCallsPage() {
  const today = getTashkentDate(0);
  const yesterday = getTashkentDate(-1);

  const [formManagerUserId, setFormManagerUserId] = useState('');
  const [formDate, setFormDate] = useState(today);
  const [formDuration, setFormDuration] = useState('');
  const [durationError, setDurationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  const [listFrom, setListFrom] = useState(getTashkentDate(-7));
  const [listTo, setListTo] = useState(today);
  const [listManagerUserId, setListManagerUserId] = useState('');

  const optionsQuery = trpc.corporateCalls.getFormOptions.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const canChooseCustomDate = optionsQuery.data?.canChooseCustomDate ?? false;
  const managers = useMemo(() => optionsQuery.data?.managers ?? [], [optionsQuery.data?.managers]);

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
    onSuccess: async (result: any) => {
      setFormDuration('');
      setDurationError(null);
      setSuccessMessage("Korporativ qo'ng'iroq davomiyligi saqlandi.");
      setWarningMessage(null);
      if (result?.telegram?.sent === false) {
        const reason = String(result?.telegram?.reason || '');
        if (reason === 'group_missing') {
          setWarningMessage("Telegramga yuborilmadi: KORPORATIV_GROUP_ID (yoki CORPORATE_CALL_GROUP_ID) sozlanmagan.");
        } else if (reason === 'token_missing') {
          setWarningMessage("Telegramga yuborilmadi: bot token topilmadi.");
        } else {
          setWarningMessage("Telegramga yuborishda xatolik bo'ldi.");
        }
      }
      await listQuery.refetch();
    },
  });
  const deleteMutation = trpc.corporateCalls.delete.useMutation({
    onSuccess: async () => {
      setSuccessMessage("Korporativ qo'ng'iroq yozuvi o'chirildi.");
      setWarningMessage(null);
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
    setWarningMessage(null);
    setDurationError(null);

    if (!formDuration.trim()) {
      setDurationError("Davomiylik HH:MM:SS formatida kiritilishi kerak.");
      return;
    }

    if (!/^\d{2}:\d{2}:\d{2}$/.test(formDuration.trim())) {
      setDurationError("Davomiylik HH:MM:SS formatida kiritilishi kerak.");
      return;
    }

    await upsertMutation.mutateAsync({
      managerUserId: canChooseCustomDate ? (formManagerUserId || undefined) : undefined,
      date: formDate,
      duration: formDuration.trim(),
    });
  };

  const handleDelete = async (id: string) => {
    if (!canChooseCustomDate) {
      return;
    }
    const confirmed = window.confirm("Ushbu korporativ qo'ng'iroq yozuvini o'chirmoqchimisiz?");
    if (!confirmed) {
      return;
    }
    setSuccessMessage(null);
    setWarningMessage(null);
    await deleteMutation.mutateAsync({ id });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>Korporativ qo&apos;ng&apos;iroq</>}
        description={<>Qo&apos;ng&apos;iroq davomiyligini qo&apos;lda kiriting. Bu ma&apos;lumotlar dashboard, sotuvchilar va hisobotlarda umumiy call duration&apos;ga qo&apos;shiladi.</>}
      />

      {(successMessage || upsertMutation.error || durationError || warningMessage) && (
        <div className="space-y-3">
          {successMessage && (
            <p className="alert alert-success">
              {successMessage}
            </p>
          )}
          {upsertMutation.error && (
            <p className="alert alert-error">
              {upsertMutation.error.message}
            </p>
          )}
          {durationError && (
            <p className="alert alert-error">
              {durationError}
            </p>
          )}
          {warningMessage && (
            <p className="alert alert-warning">
              {warningMessage}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:items-start">
        <form onSubmit={handleSubmit} className="panel p-5 sm:p-6 xl:sticky xl:top-6">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-600">
              <IconPhoneCall className="h-5 w-5" stroke={1.6} aria-hidden="true" />
            </span>
            <span className={`tabular text-2xl font-semibold tracking-tight ${formDuration ? 'text-gray-900' : 'text-gray-300'}`} aria-hidden="true">
              {formDuration || 'HH:MM:SS'}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-1">
            <div>
              <label className="field-label">Menejer</label>
              <select
                value={formManagerUserId}
                onChange={(event) => setFormManagerUserId(event.target.value)}
                disabled={!canChooseCustomDate}
                className="field"
              >
                {managers.map((manager: any) => (
                  <option key={manager.id} value={manager.id}>{manager.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label">Sana</label>
              {canChooseCustomDate ? (
                <input
                  type="date"
                  value={formDate}
                  onChange={(event) => setFormDate(event.target.value)}
                  className="field"
                />
              ) : (
                <select
                  value={formDate}
                  onChange={(event) => setFormDate(event.target.value)}
                  className="field"
                >
                  <option value={today}>Bugun ({today})</option>
                  <option value={yesterday}>Kecha ({yesterday})</option>
                </select>
              )}
            </div>

            <div>
              <label className="field-label">Davomiylik</label>
              <div className="relative">
                <IconClock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} aria-hidden="true" />
                <input
                  value={formDuration}
                  onChange={(event) => {
                    setDurationError(null);
                    setFormDuration(normalizeDurationInput(event.target.value));
                  }}
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="HH:MM:SS"
                  className="field tabular pl-9"
                />
              </div>
            </div>
          </div>

          {!canChooseCustomDate && (
            <p className="field-help mt-4">
              Menejerlar faqat bugun yoki kecha sanasiga qo&apos;lda qo&apos;ng&apos;iroq davomiyligi kiritishi mumkin.
            </p>
          )}

          <div className="mt-5 flex justify-end border-t border-gray-100 pt-4">
            <button
              type="submit"
              disabled={upsertMutation.isLoading || managers.length === 0}
              className="btn btn-primary w-full sm:w-auto xl:w-full"
            >
              <IconDeviceFloppy className="h-4 w-4" stroke={1.8} aria-hidden="true" />
              {upsertMutation.isLoading ? 'Saqlanmoqda...' : 'Saqlash'}
            </button>
          </div>
        </form>

        <div className="panel overflow-hidden">
          <div className="border-b border-gray-100 p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_auto] lg:items-end">
              <div>
                <label className="field-label">Ro&apos;yxat: Boshlanish</label>
                <input
                  type="date"
                  value={listFrom}
                  onChange={(event) => setListFrom(event.target.value)}
                  disabled={!canChooseCustomDate}
                  className="field"
                />
              </div>
              <div>
                <label className="field-label">Ro&apos;yxat: Tugash</label>
                <input
                  type="date"
                  value={listTo}
                  onChange={(event) => setListTo(event.target.value)}
                  disabled={!canChooseCustomDate}
                  className="field"
                />
              </div>
              <div>
                <label className="field-label">Menejer filtri</label>
                <select
                  value={listManagerUserId}
                  onChange={(event) => setListManagerUserId(event.target.value)}
                  disabled={!canChooseCustomDate}
                  className="field"
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
                  className="btn btn-secondary w-full"
                >
                  <IconRefresh className="h-4 w-4" stroke={1.8} aria-hidden="true" />
                  Yangilash
                </button>
              </div>
            </div>
          </div>

          <div className="p-2 sm:p-3">
            <div className="max-h-[420px] overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-left">Sana</th>
                    <th className="text-left">Menejer</th>
                    <th className="text-right">Davomiylik</th>
                    <th className="text-left">Oxirgi kiritilgan vaqt</th>
                    {canChooseCustomDate && (
                      <th className="text-right">Amal</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row: any) => (
                    <tr key={row.id}>
                      <td className="tabular whitespace-nowrap">{row.date}</td>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <UserAvatar name={String(row.managerName || '?')} size="sm" />
                          <span className="whitespace-nowrap font-medium text-gray-900">{row.managerName}</span>
                        </div>
                      </td>
                      <td className="tabular whitespace-nowrap text-right font-medium text-gray-900">{row.duration}</td>
                      <td className="tabular whitespace-nowrap text-gray-500">{formatDateTime(row.updatedAt || row.createdAt, UZ_TASHKENT_DATE_TIME)}</td>
                      {canChooseCustomDate && (
                        <td className="text-right">
                          <button
                            type="button"
                            onClick={() => handleDelete(row.id)}
                            disabled={deleteMutation.isLoading}
                            className="btn btn-danger-soft btn-sm"
                          >
                            <IconTrash className="h-3.5 w-3.5" stroke={1.8} aria-hidden="true" />
                            O'chirish
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {listQuery.isLoading ? (
              <LoadingBlock compact message="Yuklanmoqda..." />
            ) : listQuery.error ? (
              <p className="alert alert-error m-2">{listQuery.error.message}</p>
            ) : rows.length === 0 ? (
              <EmptyState className="m-2" icon={IconPhoneCall} title={<>Hozircha ma&apos;lumot yo&apos;q.</>} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
