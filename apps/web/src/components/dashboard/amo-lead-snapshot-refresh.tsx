'use client';

import { useEffect, useState } from 'react';
import { IconRefresh } from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { formatDateTime, UZ_TASHKENT_DATE_TIME } from '@/lib/format';

/** "5 daqiqa oldin"-style age of the last snapshot refresh. */
export function formatSnapshotAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'hali yangilanmagan';
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);

  if (Number.isNaN(minutes)) return 'hali yangilanmagan';
  if (minutes < 1) return 'hozirgina';
  if (minutes < 60) return `${minutes} daqiqa oldin`;
  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `${hours} soat oldin`;

  return formatDateTime(iso, UZ_TASHKENT_DATE_TIME);
}

/**
 * Shows when the amoCRM lead snapshot was last refreshed (it refreshes itself every hour) and,
 * for admins, a button to refresh it now. Dashboard queries are reloaded after a refresh.
 */
export function AmoLeadSnapshotRefresh({ isAdmin }: { isAdmin: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const utils = trpc.useUtils();
  const statusQuery = trpc.integrations.getAmoLeadSnapshotStatus.useQuery(undefined, {
    staleTime: 30_000,
    // Poll while a refresh is running so the button settles when it finishes.
    refetchInterval: (data) => (data?.refreshing ? 5_000 : 60_000),
  });
  const refresh = trpc.integrations.refreshAmoLeadSnapshot.useMutation();
  const status = statusQuery.data;
  const refreshing = refresh.isLoading || Boolean(status?.refreshing);
  const wasRefreshing = useWasTrue(Boolean(status?.refreshing));

  // Keep "N daqiqa oldin" current.
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 60_000);

    return () => clearInterval(timer);
  }, []);

  // A refresh that outlived the mutation finished in the background: reload the dashboard data.
  useEffect(() => {
    if (wasRefreshing && !status?.refreshing) void utils.invalidate();
  }, [wasRefreshing, status?.refreshing, utils]);

  if (!status?.connected) return null;

  const run = async () => {
    setError(null);
    try {
      const result = await refresh.mutateAsync();

      if (result.status === 'refreshed') {
        await utils.invalidate();
      } else {
        await statusQuery.refetch();
      }
    } catch (err: any) {
      setError(err?.message || "Yangilashda xatolik yuz berdi");
    }
  };

  const lastRefreshed = status.lastRefreshedAt ? formatDateTime(status.lastRefreshedAt, UZ_TASHKENT_DATE_TIME) : null;
  const label = refreshing ? 'Yangilanmoqda…' : `amoCRM: ${formatSnapshotAge(status.lastRefreshedAt)}`;
  const title = [
    lastRefreshed ? `Oxirgi yangilanish: ${lastRefreshed}` : "amoCRM ma'lumotlari hali yuklanmagan",
    `Avtomatik ravishda har ${status.refreshIntervalMinutes} daqiqada yangilanadi`,
    status.lastError ? `Oxirgi xato: ${status.lastError}` : null,
  ].filter(Boolean).join('\n');

  return (
    <div className="inline-flex items-center gap-2" data-testid="amo-lead-snapshot-refresh">
      {isAdmin ? (
        <button
          type="button"
          onClick={() => void run()}
          disabled={refreshing}
          title={title}
          aria-label="amoCRM ma'lumotlarini hozir yangilash"
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-gray-200 bg-white px-3 text-[13px] text-gray-600 shadow-sm hover:bg-gray-50 hover:text-gray-900 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <IconRefresh className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} stroke={1.8} aria-hidden="true" />
          {label}
        </button>
      ) : (
        <span className="text-[13px] text-gray-500" title={title}>{label}</span>
      )}
      {status.lastError && !refreshing ? (
        <span className="h-2 w-2 rounded-full bg-amber-500" title={`Oxirgi xato: ${status.lastError}`} aria-label="Oxirgi yangilanishda xato" />
      ) : null}
      {error ? <span className="text-[12px] text-red-600" role="alert">{error}</span> : null}
    </div>
  );
}

/** True for one render after `value` turns from true to false. */
function useWasTrue(value: boolean): boolean {
  const [previous, setPrevious] = useState(value);
  const changed = previous && !value;

  useEffect(() => {
    setPrevious(value);
  }, [value]);

  return changed;
}
