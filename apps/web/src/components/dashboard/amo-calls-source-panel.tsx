'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

type CallsSource = 'utel' | 'amocrm';

const SOURCE_OPTIONS: Array<{ value: CallsSource; label: string; hint: string }> = [
  { value: 'utel', label: 'Utel webhook', hint: "Qo'ng'iroqlar Utel webhook orqali keladi." },
  { value: 'amocrm', label: 'AmoCRM', hint: "Qo'ng'iroqlar har 5 daqiqada AmoCRM qo'ng'iroq yozuvlaridan olinadi." },
];

function formatDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '—';
}

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
    <div className="mt-4 rounded-md border border-blue-100 bg-white p-3" data-testid="amo-calls-source">
      <p className="text-sm font-medium text-gray-900">Qo&apos;ng&apos;iroqlar manbasi</p>
      <p className="text-xs text-gray-500">
        Barcha sahifalarda qo&apos;ng&apos;iroqlar shu manbadan hisoblanadi. Ikkalasi qo&apos;shilmaydi — aks holda bir qo&apos;ng&apos;iroq ikki marta sanaladi.
        Menejer hisoblanishi uchun unga AmoCRM foydalanuvchisi va Utel ichki raqami biriktirilgan bo&apos;lishi kerak.
      </p>

      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Qo'ng'iroqlar manbasi">
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
              className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed ${
                active
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {status?.source === 'amocrm' && (
        <div className="mt-3 space-y-1 text-xs text-gray-600">
          <p>AmoCRM dan olingan qo&apos;ng&apos;iroqlar: {status.importedCalls.toLocaleString()}</p>
          <p>Oxirgi sinxron: {formatDateTime(status.lastRunAt)}</p>
          <p>Shu vaqtgacha yuklangan: {formatDateTime(status.syncedUntil)}</p>
          {!status.backfillComplete && (
            <p className="text-amber-700">O&apos;tgan oydan beri bo&apos;lgan qo&apos;ng&apos;iroqlar yuklanmoqda — raqamlar hali to&apos;liq emas.</p>
          )}
          {status.lastError && <p className="text-red-700">Oxirgi xatolik: {status.lastError}</p>}
          <button
            type="button"
            onClick={() => void runSync()}
            disabled={syncNow.isLoading}
            className="mt-1 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {syncNow.isLoading ? 'Boshlanmoqda...' : 'Hozir sinxronlash'}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
