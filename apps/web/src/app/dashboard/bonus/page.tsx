'use client';

import { IconClockExclamation, IconCoins, IconGauge, IconListDetails, IconLock, IconTargetArrow, IconWallet } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { AttendancePenaltySection } from './_components/attendance-penalty-section';
import { BonusRulesSection } from './_components/bonus-rules-section';
import { FixedSalarySection } from './_components/fixed-salary-section';
import { KpiSettingsSection } from './_components/kpi-settings-section';
import { PlanBonusForm } from './_components/plan-bonus-form';
import { PlanBonusList } from './_components/plan-bonus-list';
import { useBonusPage } from './_components/use-bonus-page';

const SECTION_LINKS = [
  { href: '#bonus-rules', label: 'Bonus qoidalari', icon: IconCoins },
  { href: '#attendance-penalty', label: 'Davomat jarimalari', icon: IconClockExclamation },
  { href: '#kpi-settings', label: 'KPI sozlamalari', icon: IconGauge },
  { href: '#fixed-salary', label: 'Fiks maosh', icon: IconWallet },
  { href: '#plan-bonus-form', label: "Yangi plan bonus qo'shish", icon: IconTargetArrow },
  { href: '#plan-bonus-list', label: 'Yaratilgan plan bonuslar', icon: IconListDetails },
];

export default function BonusPage() {
  const vm = useBonusPage();
  const { canView, error, isManagerLike, salaryConfigQuery, success, usersQuery } = vm;

  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader title="Bonus" />
        <div className="panel flex items-start gap-3 p-5 sm:p-6">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-red-50 text-red-600">
            <IconLock className="h-[18px] w-[18px]" stroke={1.8} />
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[13.5rem_minmax(0,1fr)]">
        <aside className="hidden xl:block">
          <nav aria-label="Bonus sozlamalari bo'limlari" className="sticky top-20 space-y-0.5">
            {SECTION_LINKS.map(({ href, label, icon: LinkIcon }) => (
              <a
                key={href}
                href={href}
                className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
              >
                <LinkIcon className="h-4 w-4 flex-shrink-0 text-gray-400" stroke={1.8} />
                <span className="truncate">{label}</span>
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          <BonusRulesSection vm={vm} />

          <AttendancePenaltySection vm={vm} />

          <KpiSettingsSection vm={vm} />

          <FixedSalarySection vm={vm} />

          <PlanBonusForm vm={vm} />

          <PlanBonusList vm={vm} />
        </div>
      </div>
    </div>
  );
}
