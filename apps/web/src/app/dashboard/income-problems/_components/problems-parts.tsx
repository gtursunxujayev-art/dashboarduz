'use client';

import type { ReactNode } from 'react';
import { IconArrowsDiff, IconDatabase, IconFileSpreadsheet } from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';

/** Dark hero band: the DB vs finance difference, with both totals beside it. */
export function DifferenceHero({ dbTotal, financeTotal, differenceAmount }: { dbTotal: number; financeTotal: number; differenceAmount: number }) {
  const balanced = Number(differenceAmount) === 0;

  return (
    <article className="relative isolate overflow-hidden rounded-[20px] bg-slate-950 p-6 text-white shadow-lg ring-1 ring-inset ring-white/10 sm:p-7">
      <div
        aria-hidden="true"
        className="absolute -right-24 -top-24 -z-10 h-72 w-72 rounded-full bg-blue-600/30 blur-3xl"
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white">
              <IconArrowsDiff className="h-[18px] w-[18px]" stroke={1.6} />
            </span>
            <p className="text-sm font-medium text-white/70">Farq</p>
          </div>
          <p className={`tabular mt-4 break-words text-4xl font-semibold leading-none tracking-tight sm:text-5xl ${balanced ? 'text-emerald-300' : 'text-amber-300'}`}>
            {Number(differenceAmount).toLocaleString('uz-UZ')}
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:min-w-[420px]">
          <HeroFigure label="DB jami" value={Number(dbTotal).toLocaleString('uz-UZ')} icon={IconDatabase} />
          <HeroFigure label="Moliya jami" value={Number(financeTotal).toLocaleString('uz-UZ')} icon={IconFileSpreadsheet} />
        </dl>
      </div>
    </article>
  );
}

function HeroFigure({ label, value, icon: FigureIcon }: { label: string; value: ReactNode; icon: Icon }) {
  return (
    <div className="rounded-[16px] bg-white/[0.06] px-4 py-3 ring-1 ring-inset ring-white/10">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-white/60">
        <FigureIcon className="h-3.5 w-3.5" stroke={1.8} />
        {label}
      </dt>
      <dd className="tabular mt-1.5 break-words text-xl font-semibold leading-tight">{value}</dd>
    </div>
  );
}

/** One fact of the active snapshot: small label over the value. */
export function SnapshotFact({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`mt-1 truncate font-medium text-gray-900 ${mono ? 'tabular' : ''}`}>{children}</dd>
    </div>
  );
}

/** Compact inline number used for the prepared-preview counters. */
export function MiniStat({ label, value, icon: StatIcon, tone }: { label: string; value: ReactNode; icon: Icon; tone: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${tone}`}>
        <StatIcon className="h-[18px] w-[18px]" stroke={1.6} />
      </span>
      <div className="min-w-0">
        <p className="caption leading-snug">{label}</p>
        <p className="tabular mt-0.5 text-lg font-semibold leading-tight text-gray-900">{value}</p>
      </div>
    </div>
  );
}

export function DrilldownPanel({ title, icon: PanelIcon, children }: { title: string; icon: Icon; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600">
            <PanelIcon className="h-4 w-4" stroke={1.8} />
          </span>
          <h3 className="section-title">{title}</h3>
        </div>
      </div>
      <div className="panel-body space-y-2 text-sm">{children}</div>
    </section>
  );
}

export function DrilldownRow({ row }: { row: any }) {
  return (
    <div className="panel-inset space-y-1 py-3">
      <div className="font-medium text-gray-900">{row.paymentDate || '-'} | {row.customerName || row.customerPhone}</div>
      <div className="text-gray-600">{row.courseName} / {row.tariffName}{row.subTariffName ? ` / ${row.subTariffName}` : ''}</div>
      <div className="tabular text-gray-700">To'lov: {Number(row.paymentAmount).toLocaleString('uz-UZ')} | Kelishuv: {Number(row.agreementAmount).toLocaleString('uz-UZ')} | Qarz: {Number(row.remainingDebtAmount).toLocaleString('uz-UZ')}</div>
    </div>
  );
}
