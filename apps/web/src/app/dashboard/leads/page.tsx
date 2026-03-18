'use client';

import LeadsTable from '@/components/dashboard/leads-table';

export default function LeadsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Lidlar</h1>
        <p className="mt-1 text-sm text-gray-500">AmoCRM dan sinxron qilingan jonli lidlar ro&apos;yxati.</p>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="px-4 py-5 sm:p-6">
          <LeadsTable />
        </div>
      </div>
    </div>
  );
}
