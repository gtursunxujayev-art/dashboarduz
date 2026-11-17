'use client';

import { PageHeader } from '@/components/ui/page-header';
import { AttendanceAnomalies, AttendanceRecentEvents } from './_components/attendance-anomalies';
import { AttendanceCorrectionForm } from './_components/attendance-correction-form';
import { AttendanceAlerts, AttendanceFilters, AttendanceHeaderActions } from './_components/attendance-filters';
import { AttendanceStats, AttendanceSummaryTable } from './_components/attendance-summary-table';
import { useAttendancePage } from './_components/use-attendance-page';

export default function AttendancePage() {
  const vm = useAttendancePage();
  const hasSideColumn = vm.isAdmin || vm.canReadAnomalies;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Davomat"
        description="Face ID orqali kelgan IN/OUT yozuvlari, kunlik ishlangan vaqt va kechikishlar."
        actions={<AttendanceHeaderActions vm={vm} />}
      >
        <AttendanceFilters vm={vm} />
      </PageHeader>

      <AttendanceAlerts vm={vm} />

      <AttendanceStats vm={vm} />

      <div className={hasSideColumn ? 'grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]' : ''}>
        <div className="min-w-0 space-y-6">
          <AttendanceSummaryTable vm={vm} />
          <AttendanceRecentEvents vm={vm} />
        </div>

        {hasSideColumn && (
          <aside className="min-w-0 space-y-6">
            <AttendanceCorrectionForm vm={vm} />
            <AttendanceAnomalies vm={vm} />
          </aside>
        )}
      </div>
    </div>
  );
}
