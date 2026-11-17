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
          <span className={`badge ${pendingTotal > 0 ? 'badge-red' : 'badge-neutral'} h-10 px-4 text-[13px]`}>
            <IconClockHour4 className="h-4 w-4" stroke={1.8} />
            <span className="tabular">Kutilmoqda: {pendingTotal}</span>
          </span>
        )}
      />

      {/*
        Master/detail: request history is the main list; the new-request form sits in the right column
        on wide screens (first on phones). Not sticky: with tariff fields open the form is taller than the viewport.
      */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 xl:order-2">
          <AdjustmentRequestForm vm={vm} />
        </div>

        <div className="min-w-0 xl:order-1">
          <AdjustmentHistory vm={vm} />
        </div>
      </div>

      <AdjustmentReviewModal vm={vm} />
    </div>
  );
}
