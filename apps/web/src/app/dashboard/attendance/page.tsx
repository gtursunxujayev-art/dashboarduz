'use client';

import { PageHeader } from '@/components/ui/page-header';
import { AttendanceAnomalies } from './_components/attendance-anomalies';
import { AttendanceCorrectionForm } from './_components/attendance-correction-form';
import { AttendanceFilters, AttendanceHeaderActions } from './_components/attendance-filters';
import { AttendanceStats, AttendanceSummaryTable } from './_components/attendance-summary-table';
import { useAttendancePage } from './_components/use-attendance-page';

export default function AttendancePage() {
  const vm = useAttendancePage();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Davomat"
        description="Face ID orqali kelgan IN/OUT yozuvlari, kunlik ishlangan vaqt va kechikishlar."
        actions={<AttendanceHeaderActions vm={vm} />}
      />

      <AttendanceFilters vm={vm} />

      <AttendanceStats vm={vm} />

      <div className={vm.isAdmin ? 'grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]' : ''}>
        <div className="min-w-0">
          <AttendanceSummaryTable vm={vm} />
        </div>

        <AttendanceCorrectionForm vm={vm} />
      </div>

      <AttendanceAnomalies vm={vm} />
    </div>
  );
}
