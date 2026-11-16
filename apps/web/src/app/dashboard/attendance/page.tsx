'use client';

import { AttendanceAnomalies } from './_components/attendance-anomalies';
import { AttendanceCorrectionForm } from './_components/attendance-correction-form';
import { AttendanceFilters } from './_components/attendance-filters';
import { AttendanceSummaryTable } from './_components/attendance-summary-table';
import { useAttendancePage } from './_components/use-attendance-page';

export default function AttendancePage() {
  const vm = useAttendancePage();

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white shadow dark:bg-slate-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Davomat</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            Face ID orqali kelgan IN/OUT yozuvlari, kunlik ishlangan vaqt va kechikishlar.
          </p>
        </div>

        <div className="space-y-5 p-6">
          <AttendanceFilters vm={vm} />

          <AttendanceCorrectionForm vm={vm} />

          <AttendanceSummaryTable vm={vm} />

          <AttendanceAnomalies vm={vm} />
        </div>
      </div>
    </div>
  );
}
