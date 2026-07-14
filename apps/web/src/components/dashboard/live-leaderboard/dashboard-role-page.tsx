'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

type AgentGroup = 'online' | 'offline';

type LeaderboardAgent = {
  userId: string;
  name: string;
  group: AgentGroup;
  todayCallsCount: number;
  todayCallDurationSeconds: number;
  monthlySalesCount: number;
  monthlyIncome: number;
  todayIncome: number;
  monthlyBonus: number;
};

type LatestIncomeEvent = {
  incomeId: string;
  createdAt: string;
  entryDate: string;
  managerUserId: string;
  managerName: string;
  amount: number;
};

type SelectedReportCourse = {
  courseId: string;
  name: string;
  category: string;
  group: AgentGroup;
  salesCount: number;
  agreementAmount: number;
  tariffs: Array<{
    tariffId: string | null;
    name: string;
    salesCount: number;
  }>;
};

type GroupStats = {
  online: { todaySalesCount: number; yesterdaySalesCount: number };
  offline: { todaySalesCount: number; yesterdaySalesCount: number };
};

type PreviousMonthWinner = {
  userId: string;
  name: string;
  salesCount: number;
  income: number;
  bonus: number;
};

function formatMoney(amount: number) {
  return `${Math.round(amount || 0).toLocaleString('uz-UZ')} so'm`;
}

function formatCompactMoney(amount: number) {
  const value = Math.round(amount || 0);
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

function sortAgents(agents: LeaderboardAgent[], group: AgentGroup) {
  return agents
    .filter((agent) => agent.group === group)
    .sort((a, b) => b.monthlyIncome - a.monthlyIncome || b.monthlySalesCount - a.monthlySalesCount || a.name.localeCompare(b.name));
}

function playNewIncomeSound() {
  const audio = new Audio('/sounds/new-income.m4a');
  audio.volume = 0.1;
  void audio.play().catch(() => undefined);
  const startedAt = window.performance.now();
  const durationMs = 3000;
  const tick = () => {
    const elapsed = window.performance.now() - startedAt;
    const progress = Math.min(elapsed / durationMs, 1);
    audio.volume = 0.1 + (0.9 * progress);
    if (progress < 1) {
      window.requestAnimationFrame(tick);
    }
  };
  window.requestAnimationFrame(tick);
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.07] px-7 py-2.5 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className={`absolute -right-14 -top-20 h-40 w-40 rounded-full ${accent} opacity-30 blur-3xl`} />
      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-300">{label}</p>
      <div className="mt-3 text-4xl font-black tracking-tight text-white md:text-5xl">{formatMoney(value)}</div>
    </div>
  );
}

function AgentRow({ agent, rank, highlight }: { agent: LeaderboardAgent; rank: number; highlight: boolean }) {
  return (
    <div className={`leaderboard-row grid grid-cols-[40px_minmax(0,1fr)] items-center gap-2 rounded-3xl border px-3 py-2 transition-all duration-700 sm:grid-cols-[46px_minmax(0,1fr)_auto] sm:gap-3 ${highlight ? 'scale-[1.025] border-amber-300/70 bg-amber-300/15 shadow-[0_0_45px_rgba(251,191,36,0.25)]' : 'border-white/10 bg-white/[0.055]'}`}>
      <div className={`flex h-8 w-8 items-center justify-center rounded-xl text-base font-black ${rank === 1 ? 'bg-amber-300 text-slate-950' : rank === 2 ? 'bg-slate-200 text-slate-950' : rank === 3 ? 'bg-orange-300 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>
        {rank}
      </div>
      <div className="grid min-w-0 grid-cols-2 items-center gap-x-3 gap-y-1 sm:grid-cols-3 2xl:grid-cols-[minmax(120px,1fr)_110px_145px_80px_95px_90px]">
        <div className="col-span-2 truncate text-lg font-extrabold text-white sm:col-span-3 2xl:col-span-1">{agent.name}</div>
        <div className="text-sm font-semibold text-slate-300">
          <span>Qo'ng'iroq: <b className="text-cyan-300">{agent.todayCallsCount}</b></span>
        </div>
        <div className="text-sm font-semibold text-slate-300">
          <span>Vaqt: <b className="font-mono text-cyan-300">{formatDuration(agent.todayCallDurationSeconds)}</b></span>
        </div>
        <div className="text-sm font-semibold text-slate-300">
          <span>Sotuv: <b className="text-white">{agent.monthlySalesCount}</b></span>
        </div>
        <div className="text-sm font-semibold text-slate-300">
          <span>Bugun: <b className="text-cyan-300">{formatCompactMoney(agent.todayIncome)}</b></span>
        </div>
        <div className="text-sm font-semibold text-slate-300">
          <span>Bonus: <b className="text-fuchsia-300">{formatCompactMoney(agent.monthlyBonus)}</b></span>
        </div>
      </div>
      <div className="hidden rounded-2xl bg-slate-950/60 px-3 py-1.5 text-right sm:block">
        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Oylik</div>
        <div className="text-base font-black text-white">{formatCompactMoney(agent.monthlyIncome)}</div>
      </div>
    </div>
  );
}

function AgentLeaderboard({
  title,
  agents,
  tone,
  highlightedAgentId,
}: {
  title: string;
  agents: LeaderboardAgent[];
  tone: string;
  highlightedAgentId: string | null;
}) {
  return (
    <section className="min-h-[560px] rounded-[2rem] border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/30">
      <div className="mb-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-3 text-3xl font-black text-white">
            <span className={`mr-3 text-sm font-bold uppercase tracking-[0.28em] align-middle ${tone}`}>{title}</span>
            <span>Menejerlar</span>
          </h2>
        </div>
      </div>
      <div className="space-y-3">
        {agents.map((agent, index) => (
          <AgentRow key={agent.userId} agent={agent} rank={index + 1} highlight={highlightedAgentId === agent.userId} />
        ))}
        {!agents.length ? (
          <div className="rounded-3xl border border-dashed border-white/15 p-10 text-center text-slate-400">Bu guruhda agentlar yo'q.</div>
        ) : null}
      </div>
    </section>
  );
}

function SalesStatsPanel({
  courses,
  todaySalesCount,
  yesterdaySalesCount,
  previousMonthWinner,
  previousMonthWinnerError,
  tone,
}: {
  courses: SelectedReportCourse[];
  todaySalesCount: number;
  yesterdaySalesCount: number;
  previousMonthWinner: PreviousMonthWinner | null | undefined;
  previousMonthWinnerError: boolean;
  tone: string;
}) {
  return (
    <aside className="min-h-[560px] rounded-[2rem] border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/30">
      <div className="mb-6">
        <p className={`text-sm font-bold uppercase tracking-[0.28em] ${tone}`}>Sotuvlar</p>
        <h2 className="mt-2 text-3xl font-black text-white">Statistika</h2>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/[0.055] p-5">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Sotuvlar</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[1.7rem] font-black leading-tight text-white">
          <span className="whitespace-nowrap">
            Bugun - <span className={tone}>{todaySalesCount}</span>
          </span>
          <span className="hidden text-slate-500 min-[420px]:inline">|</span>
          <span className="whitespace-nowrap">
            Kecha - <span className={tone}>{yesterdaySalesCount}</span>
          </span>
        </p>
      </div>

      <div className="mt-5 space-y-4">
        {courses.map((course) => (
          <div key={course.courseId} className="rounded-3xl border border-white/10 bg-white/[0.055] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Tanlangan kurs</p>
                <h3 className="mt-1 text-xl font-black text-white">
                  {course.name} - <span className={tone}>{course.salesCount}</span>
                </h3>
                <p className="mt-2 text-sm font-semibold text-slate-300">
                  Kelishuv - <span className={tone}>{formatCompactMoney(course.agreementAmount)} so'm</span>
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              {course.tariffs.map((tariff) => (
                <div
                  key={`${course.courseId}:${tariff.tariffId || 'none'}`}
                  className="rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3 text-sm font-black text-slate-200"
                >
                  {tariff.name} - <span className={tone}>{tariff.salesCount}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {!courses.length ? (
          <div className="rounded-3xl border border-dashed border-white/15 p-8 text-center text-slate-400">
            Tanlangan kurs topilmadi.
          </div>
        ) : null}
      </div>

      <div className="mt-5 overflow-hidden rounded-3xl border border-amber-300/25 bg-gradient-to-br from-amber-300/15 via-white/[0.055] to-orange-400/10 p-5 shadow-[0_0_45px_rgba(251,191,36,0.08)]">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-300 text-2xl shadow-lg shadow-amber-400/20"
          >
            👑
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-200">O'tgan oy</p>
            <h3 className="mt-1 text-lg font-black leading-tight text-white">Eng yaxshi sotuvchisi</h3>
          </div>
        </div>

        {previousMonthWinnerError ? (
          <div className="mt-5 rounded-2xl border border-red-300/15 bg-red-400/5 px-4 py-5 text-center text-sm font-semibold text-red-200/80">
            Ma'lumotni yuklab bo'lmadi.
          </div>
        ) : previousMonthWinner === undefined ? (
          <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-5 text-center text-sm font-semibold text-slate-400">
            Hisoblanmoqda...
          </div>
        ) : previousMonthWinner ? (
          <>
            <p className="mt-5 truncate text-2xl font-black text-white">{previousMonthWinner.name}</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Sotuv</p>
                <p className="mt-1 text-lg font-black text-amber-200">{previousMonthWinner.salesCount}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Tushum</p>
                <p className="mt-1 text-lg font-black text-emerald-300">{formatCompactMoney(previousMonthWinner.income)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Bonus</p>
                <p className="mt-1 text-lg font-black text-fuchsia-300">{formatCompactMoney(previousMonthWinner.bonus)}</p>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-5 text-center text-sm font-semibold text-slate-400">
            O'tgan oy sotuv topilmadi.
          </div>
        )}
      </div>
    </aside>
  );
}

function IncomeCelebrationPopup({ event, onClose }: { event: LatestIncomeEvent; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 5200);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 backdrop-blur-sm">
      <div className="celebration-card pointer-events-auto max-w-xl rounded-[2.5rem] border border-amber-200/40 bg-slate-950/95 p-10 text-center shadow-[0_0_100px_rgba(251,191,36,0.28)]">
        <div className="clap-hand mx-auto mb-5 text-8xl">👏</div>
        <p className="text-sm font-bold uppercase tracking-[0.3em] text-amber-200">Yangi tushum</p>
        <h3 className="mt-4 text-4xl font-black text-white">{event.managerName}</h3>
        <p className="mt-4 text-5xl font-black text-emerald-300">{formatMoney(event.amount)}</p>
        <button onClick={onClose} className="mt-8 rounded-2xl border border-white/15 px-5 py-3 text-sm font-bold text-slate-200 transition hover:bg-white/10">
          Yopish
        </button>
      </div>
    </div>
  );
}

export default function DashboardRolePage({ group }: { group: AgentGroup }) {
  const { logout } = useAuth();
  const query = trpc.dashboard.liveLeaderboard.useQuery({ group }, {
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
    retry: 1,
  });
  const callStatsQuery = trpc.dashboard.liveLeaderboardCallStats.useQuery({ group }, {
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    retry: 1,
  });
  const previousMonthWinnerQuery = trpc.dashboard.liveLeaderboardPreviousMonthWinner.useQuery({ group }, {
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [highlightedAgentId, setHighlightedAgentId] = useState<string | null>(null);
  const [popupEvent, setPopupEvent] = useState<LatestIncomeEvent | null>(null);
  const lastSeenIncomeId = useRef<string | null>(null);
  const hasBootstrapped = useRef(false);

  const data = query.data;
  const callStatsByAgentId = useMemo(() => new Map(
    (callStatsQuery.data?.agents || []).map((agent) => [agent.userId, agent]),
  ), [callStatsQuery.data?.agents]);
  const agents = useMemo(() => sortAgents(
    (data?.agents || []).map((agent) => ({
      ...agent,
      todayCallsCount: callStatsByAgentId.get(agent.userId)?.todayCallsCount || 0,
      todayCallDurationSeconds: callStatsByAgentId.get(agent.userId)?.todayCallDurationSeconds || 0,
    })),
    group,
  ), [callStatsByAgentId, data?.agents, group]);
  const courses = useMemo(() => (data?.selectedReportCourses || []).filter((course) => course.group === group), [data?.selectedReportCourses, group]);
  const groupStats: GroupStats = data?.groupStats || {
    online: { todaySalesCount: 0, yesterdaySalesCount: 0 },
    offline: { todaySalesCount: 0, yesterdaySalesCount: 0 },
  };

  useEffect(() => {
    const latest = data?.latestIncomeEvent;
    if (!latest) return;

    if (!hasBootstrapped.current) {
      hasBootstrapped.current = true;
      lastSeenIncomeId.current = latest.incomeId;
      return;
    }

    if (latest.incomeId !== lastSeenIncomeId.current) {
      lastSeenIncomeId.current = latest.incomeId;
      setHighlightedAgentId(latest.managerUserId);
      setPopupEvent(latest);
      if (soundEnabled) {
        playNewIncomeSound();
      }
      const timer = window.setTimeout(() => setHighlightedAgentId(null), 4200);
      return () => window.clearTimeout(timer);
    }
  }, [data?.latestIncomeEvent, soundEnabled]);

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,#1e3a8a_0,#0f172a_36%,#020617_72%)] px-6 py-6 text-white md:px-10">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-7">
        {query.error ? (
          <div className="rounded-3xl border border-red-400/30 bg-red-500/10 p-5 text-red-100">{query.error.message}</div>
        ) : null}

        <section className="grid gap-5 md:grid-cols-3">
          <KpiCard label="Bugungi tushum" value={data?.kpis.todayIncome || 0} accent="bg-cyan-400" />
          <KpiCard label="Haftalik tushum" value={data?.kpis.weekIncome || 0} accent="bg-fuchsia-400" />
          <KpiCard label="Oylik tushum" value={data?.kpis.monthIncome || 0} accent="bg-emerald-400" />
        </section>

        <section className="grid gap-7 lg:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.45fr)]">
          <AgentLeaderboard
            title={group === 'online' ? 'Onlayn' : 'Oflayn'}
            agents={agents}
            tone={group === 'online' ? 'text-cyan-300' : 'text-orange-300'}
            highlightedAgentId={highlightedAgentId}
          />
          <SalesStatsPanel
            courses={courses}
            todaySalesCount={groupStats[group].todaySalesCount}
            yesterdaySalesCount={groupStats[group].yesterdaySalesCount}
            previousMonthWinner={previousMonthWinnerQuery.data?.winner}
            previousMonthWinnerError={previousMonthWinnerQuery.isError}
            tone={group === 'online' ? 'text-cyan-300' : 'text-orange-300'}
          />
        </section>
      </div>

      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded-2xl bg-slate-950/70 px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => setSoundEnabled((value) => !value)}
          className={`rounded-xl px-3 py-2 text-xs font-black transition ${soundEnabled ? 'bg-emerald-300 text-slate-950' : 'bg-white/10 text-white hover:bg-white/15'}`}
        >
          {soundEnabled ? 'Ovoz: yoqilgan' : "Ovoz: o'chirilgan"}
        </button>
        <div className="px-2 py-1 text-xs text-slate-300">
          Yangilandi: <span className="font-bold text-white">{data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString('uz-UZ') : '...'}</span>
        </div>
        <button
          type="button"
          onClick={logout}
          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold text-slate-400 transition hover:border-red-300/30 hover:bg-red-400/10 hover:text-red-200"
        >
          Chiqish
        </button>
      </div>

      {popupEvent ? <IncomeCelebrationPopup event={popupEvent} onClose={() => setPopupEvent(null)} /> : null}

      <style jsx global>{`
        .leaderboard-row {
          animation: rowEnter 420ms ease both;
        }
        .celebration-card {
          animation: popIn 360ms cubic-bezier(.2, 1.4, .25, 1) both;
        }
        .clap-hand {
          animation: clapWave 720ms ease-in-out infinite;
          transform-origin: 70% 70%;
        }
        @keyframes rowEnter {
          from { opacity: 0; transform: translateY(10px) scale(.99); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes popIn {
          from { opacity: 0; transform: translateY(24px) scale(.9); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes clapWave {
          0%, 100% { transform: rotate(-8deg) scale(1); }
          45% { transform: rotate(12deg) scale(1.18); }
          70% { transform: rotate(-2deg) scale(1.08); }
        }
      `}</style>
    </div>
  );
}
