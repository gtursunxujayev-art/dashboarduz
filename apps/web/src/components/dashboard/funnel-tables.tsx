'use client';

import { useEffect, useState } from 'react';
import {
  HOLE_LABELS,
  formatAmount,
  formatCount,
  type FunnelHole,
} from '@/app/dashboard/analytics/funnel/funnel-view';

export type FunnelTableRow = {
  userId: string;
  name: string;
  assignedLeads: number | null;
  ishlanganLeads: number | null;
  taklifLeads: number | null;
  calls: number;
  sales: number;
  avgCheck: number;
  plan: number;
};

export type FunnelTableTotals = Omit<FunnelTableRow, 'userId' | 'name' | 'assignedLeads' | 'ishlanganLeads' | 'taklifLeads'> & {
  assignedLeads: number;
  ishlanganLeads: number;
  taklifLeads: number;
};

export type LostRevenueTableRow = {
  userId: string;
  name: string;
  aktivlik: number;
  taklif: number;
  yopish: number;
  chek: number;
  mainHole: FunnelHole | null;
  lostRevenue: number;
};

export type LostRevenueTableTotals = Omit<LostRevenueTableRow, 'userId' | 'name'>;

const thClass = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500';
const tdClass = 'whitespace-nowrap px-3 py-2 text-sm text-gray-700';
const totalTdClass = 'whitespace-nowrap px-3 py-2 text-sm font-semibold text-gray-900';

export function FunnelCrmBanner({
  reason,
  unmappedNames,
  onRetry,
  isRetrying,
}: {
  reason: string | null;
  unmappedNames: string[];
  onRetry: () => void;
  isRetrying: boolean;
}) {
  const reasonText = (() => {
    if (!reason) return null;
    if (reason.startsWith('calls_')) {
      return reason.includes('timeout')
        ? "AmoCRM qo'ng'iroqlari javob berish vaqti tugadi — Ishlangan lid hisoblanmadi."
        : "AmoCRM qo'ng'iroqlari yuklanmadi — Ishlangan lid hisoblanmadi.";
    }
    if (reason.includes('timeout')) return 'AmoCRM javob berish vaqti tugadi.';
    if (reason.includes('network_error')) return 'AmoCRM bilan tarmoq aloqasida xatolik yuz berdi.';
    if (reason.includes('amo_unavailable')) return 'AmoCRM integratsiyasi mavjud emas yoki faol emas.';
    if (reason.includes('page_cap')) return "Lidlar soni juda ko'p — faqat bir qismi hisoblandi.";
    return "AmoCRM lidlar so'rovini qaytarmadi.";
  })();
  if (!reasonText && unmappedNames.length === 0) return null;
  return (
    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {reasonText && <p className="font-semibold">AmoCRM lid ma&apos;lumotlari to&apos;liq yuklanmadi.</p>}
          {reasonText && <p className="mt-1">{reasonText}</p>}
          {unmappedNames.length > 0 && (
            <p className="mt-1">AmoCRM menejeri biriktirilmagan: {unmappedNames.join(', ')}.</p>
          )}
        </div>
        {reasonText && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
          >
            {isRetrying ? 'Yuklanmoqda...' : 'Qayta urinish'}
          </button>
        )}
      </div>
    </div>
  );
}

function PlanCell({
  userId,
  plan,
  editable,
  onPlanChange,
}: {
  userId: string;
  plan: number;
  editable: boolean;
  onPlanChange?: (userId: string, plan: number) => void;
}) {
  const [value, setValue] = useState(String(plan));
  useEffect(() => setValue(String(plan)), [plan]);

  if (!editable || !onPlanChange) {
    return <span>{plan > 0 ? plan : '—'}</span>;
  }

  const commit = () => {
    const parsed = Math.max(0, Math.round(Number(value)));
    if (!Number.isFinite(parsed)) {
      setValue(String(plan));
      return;
    }
    if (parsed !== plan) onPlanChange(userId, parsed);
  };

  return (
    <input
      type="number"
      min={0}
      aria-label="Reja"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
      }}
      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  );
}

export function FunnelTable({
  rows,
  totals,
  canEditPlans,
  showMoney,
  onPlanChange,
}: {
  rows: FunnelTableRow[];
  totals: FunnelTableTotals;
  canEditPlans: boolean;
  showMoney: boolean;
  onPlanChange?: (userId: string, plan: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className={thClass}>Menejer</th>
            <th className={thClass}>Biriktirilgan lid</th>
            <th className={thClass}>Ishlangan lid</th>
            <th className={thClass}>Qo&apos;ng&apos;iroq</th>
            <th className={thClass}>Taklif</th>
            <th className={thClass}>Sotuv</th>
            {showMoney && <th className={thClass}>O&apos;rtacha chek</th>}
            <th className={thClass}>Reja</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rows.map((row) => (
            <tr key={row.userId}>
              <td className={`${tdClass} text-gray-900`}>{row.name}</td>
              <td className={tdClass}>{formatCount(row.assignedLeads)}</td>
              <td className={tdClass}>{formatCount(row.ishlanganLeads)}</td>
              <td className={tdClass}>{row.calls}</td>
              <td className={tdClass}>{formatCount(row.taklifLeads)}</td>
              <td className={tdClass}>{row.sales}</td>
              {showMoney && <td className={tdClass}>{formatAmount(row.avgCheck)}</td>}
              <td className={tdClass}>
                <PlanCell userId={row.userId} plan={row.plan} editable={canEditPlans} onPlanChange={onPlanChange} />
              </td>
            </tr>
          ))}
          <tr className="bg-gray-50" data-testid="funnel-totals">
            <td className={totalTdClass}>Jami</td>
            <td className={totalTdClass}>{totals.assignedLeads}</td>
            <td className={totalTdClass}>{totals.ishlanganLeads}</td>
            <td className={totalTdClass}>{totals.calls}</td>
            <td className={totalTdClass}>{totals.taklifLeads}</td>
            <td className={totalTdClass}>{totals.sales}</td>
            {showMoney && <td className={totalTdClass}>{formatAmount(totals.avgCheck)}</td>}
            <td className={totalTdClass}>{totals.plan > 0 ? totals.plan : '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const HOLE_KEYS: FunnelHole[] = ['aktivlik', 'taklif', 'yopish', 'chek'];

export function LostRevenueTable({
  rows,
  totals,
}: {
  rows: LostRevenueTableRow[];
  totals: LostRevenueTableTotals;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className={thClass}>Menejer</th>
            {HOLE_KEYS.map((key) => <th key={key} className={thClass}>{HOLE_LABELS[key]}</th>)}
            <th className={thClass}>Asosiy teshik</th>
            <th className={thClass}>Yo&apos;qotilgan tushum</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rows.map((row) => (
            <tr key={row.userId}>
              <td className={`${tdClass} text-gray-900`}>{row.name}</td>
              {HOLE_KEYS.map((key) => (
                <td
                  key={key}
                  className={`${tdClass} ${row.mainHole === key ? 'bg-red-50 font-semibold text-red-700' : ''}`}
                >
                  {formatAmount(row[key])}
                </td>
              ))}
              <td className={`${tdClass} font-medium`}>{row.mainHole ? HOLE_LABELS[row.mainHole] : '—'}</td>
              <td className={`${tdClass} font-semibold text-red-700`}>{formatAmount(row.lostRevenue)}</td>
            </tr>
          ))}
          <tr className="bg-gray-50" data-testid="lost-totals">
            <td className={totalTdClass}>Jami</td>
            {HOLE_KEYS.map((key) => <td key={key} className={totalTdClass}>{formatAmount(totals[key])}</td>)}
            <td className={totalTdClass}>—</td>
            <td className={`${totalTdClass} text-red-700`}>{formatAmount(totals.lostRevenue)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
