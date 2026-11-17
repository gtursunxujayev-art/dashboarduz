'use client';

import { useEffect, useState } from 'react';
import { IconAlertTriangle, IconChevronDown, IconRefresh } from '@tabler/icons-react';
import { HOLE_LABELS, formatCount, type FunnelHole } from '@/app/dashboard/analytics/funnel/funnel-view';
import { formatSomRounded } from '@/lib/format';
import { UserAvatar } from '@/components/ui/user-avatar';

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

const thClass = 'text-left';
const thNumClass = 'text-right';
const tdClass = 'whitespace-nowrap';
const tdNumClass = 'tabular whitespace-nowrap text-right';
const totalTdClass = 'whitespace-nowrap';
const totalTdNumClass = 'tabular whitespace-nowrap text-right';

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
    <div className="alert alert-warning">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <IconAlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" stroke={1.8} aria-hidden="true" />
          <div className="min-w-0">
            {reasonText && <p className="font-semibold">AmoCRM lid ma&apos;lumotlari to&apos;liq yuklanmadi.</p>}
            {reasonText && <p className="mt-1">{reasonText}</p>}
            {unmappedNames.length > 0 && (
              <p className="mt-1">AmoCRM menejeri biriktirilmagan: {unmappedNames.join(', ')}.</p>
            )}
          </div>
        </div>
        {reasonText && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="btn btn-secondary btn-sm flex-shrink-0 self-start"
          >
            <IconRefresh className={`h-3.5 w-3.5 ${isRetrying ? 'animate-spin' : ''}`} stroke={1.8} aria-hidden="true" />
            {isRetrying ? 'Yuklanmoqda...' : 'Qayta urinish'}
          </button>
        )}
      </div>
    </div>
  );
}

function stageShare(part: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.max(0, (part / total) * 100));
}

/**
 * The team funnel as horizontal stage bars: each stage's count, its width relative to the first
 * stage, and the conversion from the previous stage. Labels reuse the table's column names.
 */
export function FunnelStageBars({ totals }: { totals: FunnelTableTotals }) {
  const stages = [
    { key: 'assigned', label: 'Biriktirilgan lid', value: totals.assignedLeads },
    { key: 'ishlangan', label: 'Ishlangan lid', value: totals.ishlanganLeads },
    { key: 'taklif', label: 'Taklif', value: totals.taklifLeads },
    { key: 'sales', label: 'Sotuv', value: totals.sales },
  ];
  const base = stages[0].value;

  return (
    <ol className="space-y-1">
      {stages.map((stage, index) => {
        const previous = index > 0 ? stages[index - 1].value : null;
        const width = base > 0 ? stageShare(stage.value, base) : 0;
        return (
          <li key={stage.key}>
            {previous !== null && (
              <div className="flex items-center gap-1.5 py-1 pl-1 text-xs text-gray-500">
                <IconChevronDown className="h-3.5 w-3.5 text-gray-400" stroke={1.8} aria-hidden="true" />
                <span className="tabular font-medium text-gray-600">
                  {previous > 0 ? `${Math.round(stageShare(stage.value, previous))}%` : '-'}
                </span>
              </div>
            )}
            <div className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]">
              <span className="truncate text-sm font-medium text-gray-700">{stage.label}</span>
              <div className="h-7 overflow-hidden rounded-md bg-gray-100" aria-hidden="true">
                <div
                  className="h-full origin-left animate-grow-x rounded-md bg-blue-600"
                  style={{ width: `${Math.max(width, stage.value > 0 ? 2 : 0)}%`, opacity: 1 - index * 0.15 }}
                />
              </div>
              <span className="tabular w-14 text-right text-sm font-semibold text-gray-900">{stage.value}</span>
            </div>
          </li>
        );
      })}
    </ol>
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
      className="field tabular h-8 w-20 px-2 text-right"
    />
  );
}

function NameCell({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <UserAvatar name={name} size="sm" />
      <span className="font-medium text-gray-900">{name}</span>
    </div>
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
      <table className="data-table">
        <thead>
          <tr>
            <th className={thClass}>Menejer</th>
            <th className={thNumClass}>Biriktirilgan lid</th>
            <th className={thNumClass}>Ishlangan lid</th>
            <th className={thNumClass}>Qo&apos;ng&apos;iroq</th>
            <th className={thNumClass}>Taklif</th>
            <th className={thNumClass}>Sotuv</th>
            {showMoney && <th className={thNumClass}>O&apos;rtacha chek</th>}
            <th className={thNumClass}>Reja</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.userId}>
              <td className={tdClass}><NameCell name={row.name} /></td>
              <td className={tdNumClass}>{formatCount(row.assignedLeads)}</td>
              <td className={tdNumClass}>{formatCount(row.ishlanganLeads)}</td>
              <td className={tdNumClass}>{row.calls}</td>
              <td className={tdNumClass}>{formatCount(row.taklifLeads)}</td>
              <td className={`${tdNumClass} font-medium text-gray-900`}>{row.sales}</td>
              {showMoney && <td className={tdNumClass}>{formatSomRounded(row.avgCheck)}</td>}
              <td className={tdNumClass}>
                <PlanCell userId={row.userId} plan={row.plan} editable={canEditPlans} onPlanChange={onPlanChange} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr data-testid="funnel-totals">
            <td className={totalTdClass}>Jami</td>
            <td className={totalTdNumClass}>{totals.assignedLeads}</td>
            <td className={totalTdNumClass}>{totals.ishlanganLeads}</td>
            <td className={totalTdNumClass}>{totals.calls}</td>
            <td className={totalTdNumClass}>{totals.taklifLeads}</td>
            <td className={totalTdNumClass}>{totals.sales}</td>
            {showMoney && <td className={totalTdNumClass}>{formatSomRounded(totals.avgCheck)}</td>}
            <td className={totalTdNumClass}>{totals.plan > 0 ? totals.plan : '—'}</td>
          </tr>
        </tfoot>
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
      <table className="data-table">
        <thead>
          <tr>
            <th className={thClass}>Menejer</th>
            {HOLE_KEYS.map((key) => <th key={key} className={thNumClass}>{HOLE_LABELS[key]}</th>)}
            <th className={thClass}>Asosiy teshik</th>
            <th className={thNumClass}>Yo&apos;qotilgan tushum</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.userId}>
              <td className={tdClass}><NameCell name={row.name} /></td>
              {HOLE_KEYS.map((key) => (
                <td
                  key={key}
                  className={`${tdNumClass} ${row.mainHole === key ? 'bg-red-50 font-semibold text-red-700' : ''}`}
                >
                  {formatSomRounded(row[key])}
                </td>
              ))}
              <td className={tdClass}>
                {row.mainHole ? <span className="badge badge-red">{HOLE_LABELS[row.mainHole]}</span> : '—'}
              </td>
              <td className={`${tdNumClass} font-semibold text-red-700`}>{formatSomRounded(row.lostRevenue)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr data-testid="lost-totals">
            <td className={totalTdClass}>Jami</td>
            {HOLE_KEYS.map((key) => <td key={key} className={totalTdNumClass}>{formatSomRounded(totals[key])}</td>)}
            <td className={totalTdClass}>—</td>
            <td className={`${totalTdNumClass} text-red-700`}>{formatSomRounded(totals.lostRevenue)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
