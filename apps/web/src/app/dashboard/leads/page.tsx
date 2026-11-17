'use client';

import LeadsTable from '@/components/dashboard/leads-table';
import { PageHeader } from '@/components/ui/page-header';

export default function LeadsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Lidlar"
        description={<>AmoCRM dan sinxron qilingan jonli lidlar ro&apos;yxati.</>}
      />

      <LeadsTable />
    </div>
  );
}
