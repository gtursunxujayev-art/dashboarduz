'use client';

import { useState } from 'react';
import { IconPhoneCall, IconRefresh } from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { formatDateTime } from '@/lib/format';
import { type CallsSource } from '@dashboarduz/shared';


const SOURCE_OPTIONS: Array<{ value: CallsSource; label: string; hint: string }> = [
  { value: 'utel', label: 'Utel webhook', hint: "Qo'ng'iroqlar Utel webhook orqali keladi." },
  { value: 'amocrm', label: 'AmoCRM', hint: "Qo'ng'iroqlar har 5 daqiqada AmoCRM qo'ng'iroq yozuvlaridan olinadi." },
];

export function AmoCallsSourcePanel() {
  const [error, setError] = useState<string | null>(null);
  const statusQuery = trpc.integrations.getCallsSource.useQuery(undefined, { refetchInterval: 30_000 });
  const setSource = trpc.integrations.setCallsSource.useMutation();
  const syncNow = trpc.integrations.syncAmoCallsNow.useMutation();
  const status = statusQuery.data;

  const choose = async (source: CallsSource) => {
    setError(null);
    try {
      await setSource.mutateAsync({ source });
      await statusQuery.refetch();
    } catch (err: any) {
      setError(err?.message || "Qo'ng'iroq manbasini saqlashda xatolik");
    }
  };

  const runSync = async () => {
    setError(null);
    try {
      await syncNow.mutateAsync();
      setTimeout(() => void statusQuery.refetch(), 5_000);
    } catch (err: any) {
      setError(err?.message || 'Sinxronlashda xatolik');
    }
  };

  return (
    <div className="mt-4 rounded-[12px] border border-gray-200 p-4" data-testid="amo-calls-source">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-600">
            <IconPhoneCall className="h-[18px] w-[18px]" stroke={1.6} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Qo&apos;ng&apos;iroqlar manbasi</p>
            <p className="mt-0.5 max-w-[60ch] text-xs leading-relaxed text-gray-500">
              Barcha sahifalarda qo&apos;ng&apos;iroqlar shu manbadan hisoblanadi. Ikkalasi qo&apos;shilmaydi — aks holda bir qo&apos;ng&apos;iroq ikki marta sanaladi.
              Menejer hisoblanishi uchun unga AmoCRM foydalanuvchisi va Utel ichki raqami biriktirilgan bo&apos;lishi kerak.
            </p>
          </div>
        </div>

        <div className="segmented flex-shrink-0 self-start" role="radiogroup" aria-label="Qo'ng'iroqlar manbasi">
          {SOURCE_OPTIONS.map((option) => {
            const active = status?.source === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                title={option.hint}
                disabled={!status || setSource.isLoading || active}
                onClick={() => void choose(option.value)}
                className={`segmented-item disabled:cursor-not-allowed ${
                  active ? 'segmented-item-active' : 'disabled:opacity-50'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {status?.source === 'amocrm' && (
        <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
          <div className="grid grid-cols-1 gap-3 text-xs text-gray-500 sm:grid-cols-3">
            <p className="panel-inset p-3">AmoCRM dan olingan qo&apos;ng&apos;iroqlar: <span className="tabular mt-1 block text-sm font-semibold text-gray-900">{status.importedCalls.toLocaleString()}</span></p>
            <p className="panel-inset p-3">Oxirgi sinxron: <span className="tabular mt-1 block text-sm font-medium text-gray-900">{formatDateTime(status.lastRunAt, { emptyText: '—' })}</span></p>
            <p className="panel-inset p-3">Shu vaqtgacha yuklangan: <span className="tabular mt-1 block text-sm font-medium text-gray-900">{formatDateTime(status.syncedUntil, { emptyText: '—' })}</span></p>
          </div>
          {!status.backfillComplete && (
            <p className="alert alert-warning text-xs">O&apos;tgan oydan beri bo&apos;lgan qo&apos;ng&apos;iroqlar yuklanmoqda — raqamlar hali to&apos;liq emas.</p>
          )}
          {status.lastError && <p className="alert alert-error text-xs">Oxirgi xatolik: {status.lastError}</p>}
          <button
            type="button"
            onClick={() => void runSync()}
            disabled={syncNow.isLoading}
            className="btn btn-soft btn-sm"
          >
            <IconRefresh className={`h-3.5 w-3.5 ${syncNow.isLoading ? 'animate-spin' : ''}`} stroke={1.8} aria-hidden="true" />
            {syncNow.isLoading ? 'Boshlanmoqda...' : 'Hozir sinxronlash'}
          </button>
        </div>
      )}

      {error && <p className="alert alert-error mt-3">{error}</p>}
    </div>
  );
}
