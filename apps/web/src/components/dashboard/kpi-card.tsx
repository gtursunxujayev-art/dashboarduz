import { formatSomUz } from '@/lib/format';

/** A labelled KPI tile on a light card (analytics charts). */
export function KpiCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-2 text-xl font-semibold ${accent ? 'text-blue-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

/**
 * The large glass money tile of the live leaderboard (TV screen). `accent` is the Tailwind
 * background class of the glow behind it.
 */
export function LeaderboardKpiCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.07] px-7 py-2.5 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className={`absolute -right-14 -top-20 h-40 w-40 rounded-full ${accent} opacity-30 blur-3xl`} />
      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-300">{label}</p>
      <div className="mt-3 text-4xl font-black tracking-tight text-white md:text-5xl">{formatSomUz(value)}</div>
    </div>
  );
}
