'use client';

import { useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { formatSom } from '@/lib/format';
import { UserAvatar } from '@/components/ui/user-avatar';

type CategoryAmounts = {
  online?: number | null;
  offline?: number | null;
  intensive?: number | null;
  additional_service?: number | null;
} | null | undefined;

export type AgentBonusSummary = {
  managerUserId: string;
  managerLabel?: string | null;
  incomeAmount?: number | null;
  closedAgreementAmount?: number | null;
  totalBonusAmount?: number | null;
  bonusByCategory?: CategoryAmounts;
};

export type AgentBonusLine = {
  id: string;
  managerUserId?: string | null;
  entryDate: string | Date;
  type: string;
  customerNumber?: string | number | null;
  customerName?: string | null;
  courseName?: string | null;
  tariffName?: string | null;
  subTariffName?: string | null;
  paymentAmount?: number | null;
  calculatedBonus?: number | null;
  isLastPayment?: boolean | null;
};

const CATEGORY_FIGURES: { key: keyof NonNullable<CategoryAmounts>; label: string }[] = [
  { key: 'online', label: 'Online' },
  { key: 'offline', label: 'Offline' },
  { key: 'intensive', label: 'Intensiv' },
  { key: 'additional_service', label: "Qo'shimcha xizmat" },
];

function CategoryGrid({ amounts }: { amounts: CategoryAmounts }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {CATEGORY_FIGURES.map((figure) => (
        <div key={figure.key} className="panel-inset px-3.5 py-3">
          <p className="caption">{figure.label}</p>
          <p className="tabular mt-1 truncate text-sm font-semibold text-gray-900">{formatSom(amounts?.[figure.key])}</p>
        </div>
      ))}
    </div>
  );
}

function AgentLines({ lines }: { lines: AgentBonusLine[] }) {
  if (!lines.length) return null;
  return (
    <div className="overflow-x-auto rounded-[16px] border border-gray-100">
      <table className="data-table">
        <thead>
          <tr>
            <th className="text-left">Sana</th>
            <th className="text-left">Turi</th>
            <th className="text-left">Mijoz</th>
            <th className="text-left">Kurs/Tarif/Subtarif</th>
            <th className="text-right">Tushum</th>
            <th className="text-right">Hisoblangan bonus</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((row) => (
            <tr key={row.id}>
              <td className="tabular whitespace-nowrap text-gray-600">
                {new Date(row.entryDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })}
              </td>
              <td className="whitespace-nowrap">
                <span className={row.type === 'repayment' ? 'badge badge-amber' : 'badge badge-blue'}>
                  {row.type === 'repayment' ? "Qarzdorlik to'lovi" : 'Yangi sotuv'}
                </span>
              </td>
              <td className="whitespace-nowrap font-medium text-gray-900">
                {row.customerNumber} - {row.customerName}
              </td>
              <td className="whitespace-nowrap">
                {[row.courseName, row.tariffName, row.subTariffName].filter(Boolean).join(' / ') || '-'}
              </td>
              <td className="tabular whitespace-nowrap text-right">{formatSom(row.paymentAmount)}</td>
              <td className="tabular whitespace-nowrap text-right font-semibold text-gray-900">
                {row.isLastPayment ? formatSom(row.calculatedBonus) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Per-agent bonus breakdown: one card per agent with the total bonus large. Opening a card shows the
 * bonus split by course type and that agent's bonus lines.
 */
export function AgentBonusCards({
  agents,
  lines,
  totals,
}: {
  agents: AgentBonusSummary[];
  lines: AgentBonusLine[];
  totals?: Omit<AgentBonusSummary, 'managerUserId' | 'managerLabel'> | null;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  const toggle = (id: string) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <ul className="space-y-2.5">
        {agents.map((row) => {
          const open = openIds.has(row.managerUserId);
          const panelId = `agent-bonus-${row.managerUserId}`;
          const agentLines = open ? lines.filter((line) => line.managerUserId === row.managerUserId) : [];
          return (
            <li
              key={row.managerUserId}
              className={`overflow-hidden rounded-[16px] border transition-shadow ${open ? 'border-gray-200 shadow-md' : 'border-gray-100 hover:border-gray-200 hover:shadow-sm'}`}
            >
              <button
                type="button"
                onClick={() => toggle(row.managerUserId)}
                aria-expanded={open}
                aria-controls={panelId}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 sm:gap-4"
              >
                <UserAvatar name={row.managerLabel || '?'} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900">{row.managerLabel}</p>
                  <p className="tabular mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
                    <span>Tushum <span className="font-medium text-gray-700">{formatSom(row.incomeAmount)}</span></span>
                    <span>Yopilgan tushum <span className="font-medium text-gray-700">{formatSom(row.closedAgreementAmount)}</span></span>
                  </p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="caption hidden sm:block">Jami bonus</p>
                  <p className="tabular text-lg font-semibold leading-tight tracking-tight text-gray-900 sm:text-xl">{formatSom(row.totalBonusAmount)}</p>
                </div>
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                  <IconChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} stroke={1.8} />
                </span>
              </button>
              {open ? (
                <div id={panelId} className="animate-fade-in space-y-3 border-t border-gray-100 px-4 py-4">
                  <CategoryGrid amounts={row.bonusByCategory} />
                  <AgentLines lines={agentLines} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {totals ? (
        <div className="rounded-[16px] bg-gray-50 px-4 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-gray-900">Jami</p>
            <p className="tabular text-xl font-semibold tracking-tight text-gray-900">{formatSom(totals.totalBonusAmount)}</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
            {[
              { label: 'Tushum', value: totals.incomeAmount },
              { label: 'Yopilgan tushum', value: totals.closedAgreementAmount },
              ...CATEGORY_FIGURES.map((figure) => ({ label: figure.label, value: totals.bonusByCategory?.[figure.key] })),
            ].map((figure) => (
              <div key={figure.label} className="min-w-0">
                <p className="caption">{figure.label}</p>
                <p className="tabular mt-1 truncate text-sm font-semibold text-gray-900">{formatSom(figure.value)}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
