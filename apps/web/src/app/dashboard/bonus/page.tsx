'use client';

import { AttendancePenaltySection } from './_components/attendance-penalty-section';
import { BonusRulesSection } from './_components/bonus-rules-section';
import { FixedSalarySection } from './_components/fixed-salary-section';
import { KpiSettingsSection } from './_components/kpi-settings-section';
import { PlanBonusForm } from './_components/plan-bonus-form';
import { PlanBonusList } from './_components/plan-bonus-list';
import { useBonusPage } from './_components/use-bonus-page';

export default function BonusPage() {
  const vm = useBonusPage();
  const { canView, error, isManagerLike, salaryConfigQuery, success, usersQuery } = vm;

  if (!canView) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg bg-white p-6 shadow">
          <h1 className="text-xl font-semibold text-gray-900">Bonus</h1>
          <p className="mt-2 text-sm text-red-600">Bu sahifa faqat Admin va Manager/Team lider uchun mavjud.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h1 className="text-xl font-semibold text-gray-900">Bonus</h1>
          <p className="mt-1 text-sm text-gray-500">Agent bonus va fiks maosh sozlamalari.</p>
        </div>

        <div className="p-6">
          {isManagerLike && (
            <p className="mb-4 rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
              Manager/Team lider bu sahifani ko&apos;ra oladi, lekin o&apos;zgartirish faqat Admin uchun ochiq.
            </p>
          )}

          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {success && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}
          {salaryConfigQuery.error && (
            <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{salaryConfigQuery.error.message}</p>
          )}
          {usersQuery.error && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
              Agentlar ro&apos;yxatini yuklashda xatolik.
            </p>
          )}
        </div>
      </div>

      <BonusRulesSection vm={vm} />

      <AttendancePenaltySection vm={vm} />

      <KpiSettingsSection vm={vm} />

      <FixedSalarySection vm={vm} />

      <PlanBonusForm vm={vm} />

      <PlanBonusList vm={vm} />
    </div>
  );
}
