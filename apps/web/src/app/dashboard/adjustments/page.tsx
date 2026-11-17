'use client';

import { IconClockHour4 } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { AdjustmentHistory } from './_components/adjustment-history';
import { AdjustmentRequestForm } from './_components/adjustment-request-form';
import { AdjustmentReviewModal } from './_components/adjustment-review-modal';
import { useAdjustmentsPage } from './_components/use-adjustments-page';

export default function AdjustmentsPage() {
  const vm = useAdjustmentsPage();
  const { adjustmentBadgeQuery } = vm;
  const pendingTotal = adjustmentBadgeQuery.data?.pendingTotal ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Qaytarish / O'zgarish"
        description="Pul qaytarish yoki tarif o'zgarishi bo'yicha so'rov yuboring va tasdiqlash holatini kuzating."
        actions={(
          <span className={`badge ${pendingTotal > 0 ? 'badge-red' : 'badge-neutral'} px-3 py-1 text-[13px]`}>
            <IconClockHour4 className="h-4 w-4" stroke={1.8} />
            <span className="tabular">Kutilmoqda: {pendingTotal}</span>
          </span>
        )}
      />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <AdjustmentRequestForm vm={vm} />

        <AdjustmentHistory vm={vm} />
      </div>

      <AdjustmentReviewModal vm={vm} />
    </div>
  );
}
