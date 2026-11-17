'use client';

import type { ReactNode } from 'react';
import { IconDownload, IconFileSpreadsheet, IconListDetails } from '@tabler/icons-react';
import { formatAmountDigits } from '@/lib/format';
import type { IncomePageModel } from './use-income-page';

function SummaryRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <dt className="flex-shrink-0 text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-gray-900">{children}</dd>
    </div>
  );
}

/** Live read-out of what the entry form will save, so the operator can check it before submitting. */
function EntrySummary({ vm }: { vm: IncomePageModel }) {
  const { customerName, customerNumber, entryDate, formatIncomeType, managerUserId, managers, paymentInput, remainingDebtAmount, type } = vm;
  const managerLabel = managers.find((manager) => manager.id === managerUserId)?.label;

  return (
    <section className="panel">
      <div className="panel-header">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600">
            <IconListDetails className="h-4 w-4" stroke={1.8} />
          </span>
          <h2 className="section-title">Xulosa</h2>
        </div>
      </div>
      <div className="panel-body pt-3 sm:pt-3">
        <dl className="divide-y divide-gray-100">
          <SummaryRow label="Sana">
            <span className="tabular">{entryDate || '-'}</span>
          </SummaryRow>
          <SummaryRow label="Sotuv menedjeri">{managerLabel || '-'}</SummaryRow>
          <SummaryRow label="Mijoz">
            {customerNumber ? (
              <>
                <span className="tabular">{customerNumber}</span>
                {customerName ? <span className="block text-xs font-normal text-gray-500">{customerName}</span> : null}
              </>
            ) : '-'}
          </SummaryRow>
          <SummaryRow label="To'lov turi">{type ? formatIncomeType(type) : '-'}</SummaryRow>
        </dl>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="panel-inset py-3">
            <p className="caption">To&apos;lov</p>
            <p className="tabular mt-1.5 break-words text-lg font-semibold leading-tight text-gray-900">{paymentInput || '0'}</p>
          </div>
          <div className="panel-inset py-3">
            <p className="caption">Qarzdorlik</p>
            <p className={`tabular mt-1.5 break-words text-lg font-semibold leading-tight ${remainingDebtAmount > 0 ? 'text-amber-700' : 'text-gray-900'}`}>
              {formatAmountDigits(remainingDebtAmount)}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Admin-only: download incomes for a custom date range. */
function ExportCard({ vm }: { vm: IncomePageModel }) {
  const { exportDateFrom, exportDateTo, exportError, exportIncomesMutation, exportSuccess, handleDownloadIncomesByCustomRange, setExportDateFrom, setExportDateTo } = vm;

  return (
    <section className="panel">
      <div className="panel-header">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <IconFileSpreadsheet className="h-4 w-4" stroke={1.8} />
          </span>
          <h2 className="section-title">Eksport</h2>
        </div>
      </div>
      <div className="panel-body space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label">Boshlanish</label>
            <input
              type="date"
              value={exportDateFrom}
              onChange={(event) => setExportDateFrom(event.target.value)}
              className="field"
            />
          </div>
          <div>
            <label className="field-label">Tugash</label>
            <input
              type="date"
              value={exportDateTo}
              onChange={(event) => setExportDateTo(event.target.value)}
              className="field"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={handleDownloadIncomesByCustomRange}
          disabled={exportIncomesMutation.isLoading}
          className="btn btn-secondary w-full"
        >
          <IconDownload className="h-4 w-4" stroke={1.8} />
          {exportIncomesMutation.isLoading ? 'Yuklanmoqda...' : "Davr bo'yicha yuklab olish"}
        </button>
        {exportError && <p className="field-error">{exportError}</p>}
        {exportSuccess && <p className="mt-1.5 text-xs text-emerald-600">{exportSuccess}</p>}
      </div>
    </section>
  );
}

/** Right column of the income workspace: sticky on wide screens. */
export function IncomeEntryAside({ vm }: { vm: IncomePageModel }) {
  return (
    <aside className="space-y-4 xl:sticky xl:top-20">
      <EntrySummary vm={vm} />
      {vm.isAdmin && <ExportCard vm={vm} />}
    </aside>
  );
}
