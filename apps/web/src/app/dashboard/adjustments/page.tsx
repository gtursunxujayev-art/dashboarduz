'use client';

import { AdjustmentHistory } from './_components/adjustment-history';
import { AdjustmentRequestForm } from './_components/adjustment-request-form';
import { AdjustmentReviewModal } from './_components/adjustment-review-modal';
import { useAdjustmentsPage } from './_components/use-adjustments-page';

export default function AdjustmentsPage() {
  const vm = useAdjustmentsPage();
  const { adjustmentBadgeQuery } = vm;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-slate-100">Qaytarish / O&apos;zgarish</h1>
          <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
            Kutilmoqda: {adjustmentBadgeQuery.data?.pendingTotal ?? 0}
          </span>
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          Pul qaytarish yoki tarif o&apos;zgarishi bo&apos;yicha so&apos;rov yuboring va tasdiqlash holatini kuzating.
        </p>
      </div>

      <AdjustmentRequestForm vm={vm} />

      <AdjustmentHistory vm={vm} />

      <AdjustmentReviewModal vm={vm} />
    </div>
  );
}
