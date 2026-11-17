import { formatSomUz } from '@/lib/format';

/** A labelled KPI tile on a light card (analytics charts). */
export function KpiCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="panel relative flex min-w-0 flex-col justify-between gap-3 overflow-hidden p-5">
      <span aria-hidden="true" className={`absolute inset-y-5 left-0 w-[3px] rounded-r-full ${accent ? 'bg-blue-600' : 'bg-gray-200'}`} />
      <p className="caption leading-snug">{label}</p>
      <p className={`tabular break-words text-[24px] font-semibold leading-none tracking-[-0.02em] ${accent ? 'text-blue-700' : 'text-gray-900'}`}>{value}</p>
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
