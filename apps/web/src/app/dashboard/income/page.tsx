'use client';

import { PageHeader } from '@/components/ui/page-header';
import { EditIncomeModal } from './_components/edit-income-modal';
import { IncomeEntryForm } from './_components/income-entry-form';
import { RecentIncomes } from './_components/recent-incomes';
import { useIncomePage } from './_components/use-income-page';

export default function IncomePage() {
  const vm = useIncomePage();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mijoz va tushum"
        description="Mijoz bo'yicha yangi sotuv va qarz to'lovlarini qo'shing."
      />

      <IncomeEntryForm vm={vm} />

      <RecentIncomes vm={vm} />

      <EditIncomeModal vm={vm} />
    </div>
  );
}
