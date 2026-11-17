'use client';

import { useEffect, useState } from 'react';
import { IconClockExclamation, IconCoins, IconGauge, IconLock, IconTargetArrow, IconWallet } from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { AttendancePenaltySection } from './_components/attendance-penalty-section';
import { BonusRulesSection } from './_components/bonus-rules-section';
import { FixedSalarySection } from './_components/fixed-salary-section';
import { KpiSettingsSection } from './_components/kpi-settings-section';
import { PlanBonusForm } from './_components/plan-bonus-form';
import { PlanBonusList } from './_components/plan-bonus-list';
import { useBonusPage } from './_components/use-bonus-page';

type GroupKey = 'bonus-rules' | 'attendance-penalty' | 'kpi-settings' | 'fixed-salary' | 'plan-bonus';

const SETTING_GROUPS: { key: GroupKey; label: string; icon: Icon; anchors: string[] }[] = [
  { key: 'bonus-rules', label: 'Bonus qoidalari', icon: IconCoins, anchors: ['bonus-rules'] },
  { key: 'attendance-penalty', label: 'Davomat jarimalari', icon: IconClockExclamation, anchors: ['attendance-penalty'] },
  { key: 'kpi-settings', label: 'KPI sozlamalari', icon: IconGauge, anchors: ['kpi-settings'] },
  { key: 'fixed-salary', label: 'Fiks maosh', icon: IconWallet, anchors: ['fixed-salary'] },
  { key: 'plan-bonus', label: 'Plan bonuslar', icon: IconTargetArrow, anchors: ['plan-bonus', 'plan-bonus-form', 'plan-bonus-list'] },
];

function groupFromHash(hash: string): GroupKey | null {
  const anchor = hash.replace(/^#/, '');
  return SETTING_GROUPS.find((group) => group.anchors.includes(anchor))?.key ?? null;
}

export default function BonusPage() {
  const vm = useBonusPage();
  const { canView, error, isManagerLike, salaryConfigQuery, success, usersQuery } = vm;
  const [activeGroup, setActiveGroup] = useState<GroupKey>('bonus-rules');

  // Old in-page links (#kpi-settings, #plan-bonus-list, ...) still open the right group.
  useEffect(() => {
    const sync = () => {
      const fromHash = groupFromHash(window.location.hash);
      if (fromHash) setActiveGroup(fromHash);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader title="Bonus" />
        <div className="panel flex items-start gap-3 p-5 sm:p-6">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
            <IconLock className="h-[18px] w-[18px]" stroke={1.6} />
          </span>
          <p className="pt-2 text-sm text-red-600">Bu sahifa faqat Admin va Manager/Team lider uchun mavjud.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Bonus" description="Agent bonus va fiks maosh sozlamalari." />

      {(isManagerLike || error || success || salaryConfigQuery.error || usersQuery.error) && (
        <div className="space-y-3">
          {isManagerLike && (
            <p className="alert alert-warning">
              Manager/Team lider bu sahifani ko&apos;ra oladi, lekin o&apos;zgartirish faqat Admin uchun ochiq.
            </p>
          )}

          {error && <p className="alert alert-error">{error}</p>}
          {success && <p className="alert alert-success">{success}</p>}
          {salaryConfigQuery.error && (
            <p className="alert alert-error">{salaryConfigQuery.error.message}</p>
          )}
          {usersQuery.error && (
            <p className="alert alert-warning">
              Agentlar ro&apos;yxatini yuklashda xatolik.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[15rem_minmax(0,1fr)] xl:gap-8">
        <aside className="min-w-0">
          <nav aria-label="Bonus sozlamalari bo'limlari" className="xl:sticky xl:top-20">
            <div
              role="tablist"
              aria-orientation="vertical"
              className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 xl:mx-0 xl:flex-col xl:overflow-visible xl:px-0 xl:pb-0"
            >
              {SETTING_GROUPS.map(({ key, label, icon: GroupIcon }) => {
                const active = activeGroup === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    id={`bonus-tab-${key}`}
                    aria-selected={active}
                    aria-controls={`bonus-group-${key}`}
                    onClick={() => setActiveGroup(key)}
                    className={`group flex flex-shrink-0 items-center gap-3 whitespace-nowrap rounded-full py-1.5 pl-1.5 pr-4 text-left text-sm font-medium xl:w-full ${
                      active ? 'bg-white text-gray-900 shadow' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                        active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 group-hover:bg-white'
                      }`}
                    >
                      <GroupIcon className="h-4 w-4" stroke={1.8} />
                    </span>
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        </aside>

        <div
          key={activeGroup}
          role="tabpanel"
          id={`bonus-group-${activeGroup}`}
          aria-labelledby={`bonus-tab-${activeGroup}`}
          className="min-w-0 animate-fade-in"
        >
          {activeGroup === 'bonus-rules' ? <BonusRulesSection vm={vm} /> : null}
          {activeGroup === 'attendance-penalty' ? <AttendancePenaltySection vm={vm} /> : null}
          {activeGroup === 'kpi-settings' ? <KpiSettingsSection vm={vm} /> : null}
          {activeGroup === 'fixed-salary' ? <FixedSalarySection vm={vm} /> : null}
          {activeGroup === 'plan-bonus' ? (
            <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_440px]">
              <PlanBonusList vm={vm} />
              <div className="2xl:sticky 2xl:top-20">
                <PlanBonusForm vm={vm} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
