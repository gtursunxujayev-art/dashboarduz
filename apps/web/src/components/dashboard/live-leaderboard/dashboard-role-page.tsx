'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';

type AgentGroup = 'online' | 'offline';

type LeaderboardAgent = {
  userId: string;
  name: string;
  group: AgentGroup;
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

function sortAgents(agents: LeaderboardAgent[], group: AgentGroup) {
  return agents
    .filter((agent) => agent.group === group)
    .sort((a, b) => b.monthlyIncome - a.monthlyIncome || b.monthlySalesCount - a.monthlySalesCount || a.name.localeCompare(b.name));
}

function playNewIncomeSound() {
  const audio = new Audio('/sounds/new-income.m4a');
  audio.volume = 1;
  void audio.play().catch(() => undefined);
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.07] px-7 py-4 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className={`absolute -right-14 -top-20 h-40 w-40 rounded-full ${accent} opacity-30 blur-3xl`} />
      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-300">{label}</p>
      <div className="mt-3 text-4xl font-black tracking-tight text-white md:text-5xl">{formatMoney(value)}</div>
    </div>
  );
}

function AgentRow({ agent, rank, highlight }: { agent: LeaderboardAgent; rank: number; highlight: boolean }) {
  return (
    <div className={`leaderboard-row grid grid-cols-[50px_1fr_auto] items-center gap-3 rounded-3xl border px-3 py-2 transition-all duration-700 ${highlight ? 'scale-[1.025] border-amber-300/70 bg-amber-300/15 shadow-[0_0_45px_rgba(251,191,36,0.25)]' : 'border-white/10 bg-white/[0.055]'}`}>
      <div className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg font-black ${rank === 1 ? 'bg-amber-300 text-slate-950' : rank === 2 ? 'bg-slate-200 text-slate-950' : rank === 3 ? 'bg-orange-300 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>
        {rank}
      </div>
      <div className="min-w-0">
        <div className="truncate text-lg font-extrabold text-white">{agent.name}</div>
        <div className="mt-1 grid grid-cols-2 gap-2 text-sm font-semibold text-slate-300 sm:grid-cols-4">
          <span>Sotuv: <b className="text-white">{agent.monthlySalesCount}</b></span>
          <span>Oy: <b className="text-emerald-300">{formatCompactMoney(agent.monthlyIncome)}</b></span>
          <span>Bugun: <b className="text-cyan-300">{formatCompactMoney(agent.todayIncome)}</b></span>
          <span>Bonus: <b className="text-fuchsia-300">{formatCompactMoney(agent.monthlyBonus)}</b></span>
        </div>
      </div>
      <div className="hidden rounded-2xl bg-slate-950/60 px-3 py-2 text-right sm:block">
        <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Oylik</div>
        <div className="text-base font-black text-white">{formatCompactMoney(agent.monthlyIncome)}</div>
      </div>
    </div>
  );
}

function AgentLeaderboard({ title, agents, tone, highlightedAgentId }: { title: string; agents: LeaderboardAgent[]; tone: string; highlightedAgentId: string | null }) {
  return (
    <section className="min-h-[560px] rounded-[2rem] border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/30">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-white">
            <span className={`mr-3 text-sm font-bold uppercase tracking-[0.28em] align-middle ${tone}`}>{title}</span>
            Menejerlar
          </h2>
        </div>
        <div className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-bold text-slate-200">{agents.length} ta</div>
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

export default function DashboardRolePage() {
  const query = trpc.dashboard.liveLeaderboard.useQuery(undefined, {
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
    retry: 1,
  });
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [highlightedAgentId, setHighlightedAgentId] = useState<string | null>(null);
  const [popupEvent, setPopupEvent] = useState<LatestIncomeEvent | null>(null);
  const lastSeenIncomeId = useRef<string | null>(null);
  const hasBootstrapped = useRef(false);

  const data = query.data;
  const onlineAgents = useMemo(() => sortAgents(data?.agents || [], 'online'), [data?.agents]);
  const offlineAgents = useMemo(() => sortAgents(data?.agents || [], 'offline'), [data?.agents]);

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
        <header className="flex justify-end">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSoundEnabled((value) => !value)}
              className={`rounded-xl px-3 py-2 text-xs font-black transition ${soundEnabled ? 'bg-emerald-300 text-slate-950' : 'bg-white/10 text-white hover:bg-white/15'}`}
            >
              {soundEnabled ? 'Ovoz: yoqilgan' : "Ovoz: o'chirilgan"}
            </button>
            <div className="rounded-xl bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
              Yangilandi: <span className="font-bold text-white">{data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString('uz-UZ') : '...'}</span>
            </div>
          </div>
        </header>

        {query.error ? (
          <div className="rounded-3xl border border-red-400/30 bg-red-500/10 p-5 text-red-100">{query.error.message}</div>
        ) : null}

        <section className="grid gap-5 md:grid-cols-3">
          <KpiCard label="Bugungi tushum" value={data?.kpis.todayIncome || 0} accent="bg-cyan-400" />
          <KpiCard label="Haftalik tushum" value={data?.kpis.weekIncome || 0} accent="bg-fuchsia-400" />
          <KpiCard label="Oylik tushum" value={data?.kpis.monthIncome || 0} accent="bg-emerald-400" />
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <AgentLeaderboard title="Onlayn" agents={onlineAgents} tone="text-cyan-300" highlightedAgentId={highlightedAgentId} />
          <AgentLeaderboard title="Oflayn" agents={offlineAgents} tone="text-orange-300" highlightedAgentId={highlightedAgentId} />
        </section>
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
