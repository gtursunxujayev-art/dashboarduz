'use client';

import { EditIncomeModal } from './_components/edit-income-modal';
import { IncomeEntryForm } from './_components/income-entry-form';
import { RecentIncomes } from './_components/recent-incomes';
import { useIncomePage } from './_components/use-income-page';

export default function IncomePage() {
  const vm = useIncomePage();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-slate-100">Mijoz va tushum</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          Mijoz bo'yicha yangi sotuv va qarz to'lovlarini qo'shing.
        </p>
      </div>

      <IncomeEntryForm vm={vm} />

      <RecentIncomes vm={vm} />

      <EditIncomeModal vm={vm} />
    </div>
  );
}
