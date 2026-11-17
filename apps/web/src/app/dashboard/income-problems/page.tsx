'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import {
  IconAlertTriangle,
  IconArrowsDiff,
  IconBolt,
  IconCircleCheck,
  IconDatabase,
  IconDownload,
  IconEye,
  IconFileSpreadsheet,
  IconHash,
  IconQuestionMark,
  IconSearch,
  IconTable,
  IconUpload,
} from '@tabler/icons-react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { trpc } from '@/lib/trpc';
import { DifferenceHero, DrilldownPanel, DrilldownRow, MiniStat, SnapshotFact } from './_components/problems-parts';

type RawCell = string | number | boolean | null;
type SheetData = { name: string; rows: RawCell[][] };
type MappingState = Record<string, string>;

const STATUS_TONES: Record<string, string> = {
  matched: 'badge-green',
  amount_mismatch: 'badge-red',
  count_mismatch: 'badge-amber',
  only_in_db: 'badge-blue',
  only_in_finance: 'badge-blue',
  ambiguous_match: 'badge-amber',
};

const MAPPING_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'paymentDate', label: "To'lov sanasi" },
  { key: 'customerPhone', label: 'Telefon raqami' },
  { key: 'customerName', label: 'Mijoz ism-familiyasi' },
  { key: 'telegramUsername', label: 'Telegram username' },
  { key: 'managerLabel', label: 'Agent / operator' },
  { key: 'courseName', label: 'Kurs' },
  { key: 'tariffName', label: 'Tarif' },
  { key: 'subTariffName', label: 'Subtarif' },
  { key: 'paymentType', label: "To'lov turi" },
  { key: 'agreementAmount', label: 'Kelishuv summasi' },
  { key: 'paymentAmount', label: "To'lov summasi" },
  { key: 'remainingDebtAmount', label: 'Qolgan qarz' },
  { key: 'deadline', label: 'Deadline' },
];

function toMappingState(mapping: Record<string, number | null | undefined> | undefined): MappingState {
  const next: MappingState = {};
  for (const field of MAPPING_FIELDS) {
    const value = mapping?.[field.key];
    next[field.key] = value == null ? '' : String(value);
  }
  return next;
}

function fromMappingState(mapping: MappingState): Record<string, number | null> {
  const next: Record<string, number | null> = {};
  for (const field of MAPPING_FIELDS) {
    next[field.key] = mapping[field.key] === '' ? null : Number(mapping[field.key]);
  }
  return next;
}

function todayDateValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStartDateValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

async function exportMismatchRowsToExcel(rows: any[], summary: any, statusLabels: Record<string, string>, dateFrom: string, dateTo: string) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const summaryRows = [
    { "Ko'rsatkich": 'DB jami', Qiymat: summary.dbTotal },
    { "Ko'rsatkich": 'Moliya jami', Qiymat: summary.financeTotal },
    { "Ko'rsatkich": 'Farq', Qiymat: summary.differenceAmount },
    { "Ko'rsatkich": 'Mos mijozlar', Qiymat: summary.matchedCustomers },
    { "Ko'rsatkich": 'Faqat bazada', Qiymat: summary.onlyInDbCustomers },
    { "Ko'rsatkich": 'Faqat moliya faylida', Qiymat: summary.onlyInFinanceCustomers },
    { "Ko'rsatkich": 'Summa farqi', Qiymat: summary.amountMismatchCount },
    { "Ko'rsatkich": 'Noaniq moslik', Qiymat: summary.ambiguousMatchCount },
  ];
  const mismatchRows = rows.map((row) => ({
    Telefon: row.phone || '',
    Mijoz: row.name || '',
    'DB jami': row.dbTotalPaid,
    'Moliya jami': row.financeTotalPaid,
    Farq: row.differenceAmount,
    "DB to'lovlar soni": row.dbPaymentCount,
    "Moliya to'lovlar soni": row.financePaymentCount,
    Status: statusLabels[row.status] || row.status,
    "Moslik usuli": row.matchedBy === 'name' ? "Ism bo'yicha" : "Telefon bo'yicha",
  }));

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Hisobot');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(mismatchRows), 'Muammolar');
  XLSX.writeFile(workbook, `tushum-muammolari-${dateFrom}-${dateTo}.xlsx`);
}

export default function IncomeProblemsPage() {
  const activeSnapshotQuery = trpc.incomeProblems.getActiveSnapshot.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const uploadMutation = trpc.incomeProblems.uploadFinanceSnapshot.useMutation();
  const prepareMutation = trpc.incomeProblems.prepareFinanceSnapshot.useMutation();
  const activateMutation = trpc.incomeProblems.activateFinanceSnapshot.useMutation();
  const [drilldownInput, setDrilldownInput] = useState<any | null>(null);
  const drilldownQuery = trpc.incomeProblems.customerDrilldown.useQuery(drilldownInput as any, {
    enabled: Boolean(drilldownInput),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [selectedSheetName, setSelectedSheetName] = useState('');
  const [mappingState, setMappingState] = useState<MappingState>(() => toMappingState(undefined));
  const [dateFrom, setDateFrom] = useState(monthStartDateValue());
  const [dateTo, setDateTo] = useState(todayDateValue());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [appliedFilters, setAppliedFilters] = useState<{ dateFrom: string; dateTo: string; search?: string; status?: any } | null>(null);
  const [selectedRow, setSelectedRow] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // UI-only: which problem type the results table shows (client-side view over the loaded rows).
  const [statusView, setStatusView] = useState('all');

  const compareQuery = trpc.incomeProblems.compare.useQuery(appliedFilters as any, {
    enabled: Boolean(appliedFilters),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const selectedSheet = useMemo(
    () => sheets.find((sheet) => sheet.name === selectedSheetName) || null,
    [sheets, selectedSheetName],
  );
  const headerOptions = useMemo(
    () => (prepareMutation.data?.headers || []).map((header: string, index: number) => ({ value: String(index), label: header || `Ustun ${index + 1}` })),
    [prepareMutation.data],
  );
  const statusLabels: Record<string, string> = {
    matched: 'Mos',
    amount_mismatch: 'Summa farqi',
    count_mismatch: 'Soni farqi',
    only_in_db: 'Faqat bazada',
    only_in_finance: 'Faqat moliya faylida',
    ambiguous_match: 'Noaniq moslik',
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccess(null);
    setSelectedRow(null);

    const buffer = await file.arrayBuffer();
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'array' });
    const parsedSheets = workbook.SheetNames.map((sheetName) => ({
      name: sheetName,
      rows: (XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '' }) as RawCell[][]),
    }));

    setFileName(file.name);
    setSheets(parsedSheets);

    const uploadResult = await uploadMutation.mutateAsync({
      workbookName: file.name,
      sheets: parsedSheets.map((sheet) => ({
        name: sheet.name,
        rowCount: sheet.rows.length,
        headers: (sheet.rows[0] || []).map((cell) => String(cell ?? '')),
      })),
    });

    const nextSheetName = uploadResult.recommendedSheetName || parsedSheets[0]?.name || '';
    setSelectedSheetName(nextSheetName);
    setMappingState(toMappingState(undefined));
  };

  const handlePrepare = async () => {
    if (!selectedSheet) {
      setError('Avval sheet tanlang.');
      return;
    }
    setError(null);
    setSuccess(null);
    const prepared = await prepareMutation.mutateAsync({
      workbookName: fileName,
      sheetName: selectedSheet.name,
      rows: selectedSheet.rows,
      mapping: fromMappingState(mappingState),
    });
    setMappingState(toMappingState(prepared.mapping));
  };

  const handleActivate = async () => {
    if (!selectedSheet) {
      setError('Aktivlashtirish uchun sheet tanlang.');
      return;
    }
    setError(null);
    const result = await activateMutation.mutateAsync({
      workbookName: fileName,
      sheetName: selectedSheet.name,
      rows: selectedSheet.rows,
      mapping: fromMappingState(mappingState) as any,
    });
    setSuccess(`Snapshot saqlandi: ${result.rowCount} qator.`);
    await activeSnapshotQuery.refetch();
  };

  const handleCompare = async () => {
    setSelectedRow(null);
    setAppliedFilters({
      dateFrom,
      dateTo,
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(status ? { status } : {}),
    });
  };

  const handleOpenDrilldown = (row: any) => {
    setSelectedRow(row);
    setDrilldownInput({
      dateFrom,
      dateTo,
      dbGroupKeys: row.dbGroupKeys,
      financeGroupKeys: row.financeGroupKeys,
    });
  };

  const handleExport = async () => {
    if (!compareQuery.data) return;
    await exportMismatchRowsToExcel(compareQuery.data.rows, compareQuery.data.summary, statusLabels, dateFrom, dateTo);
  };

  const compareRows: any[] = compareQuery.data?.rows ?? [];
  const statusCounts = compareRows.reduce<Record<string, number>>((counts, row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }, {});
  const presentStatuses = Object.keys(statusLabels).filter((key) => statusCounts[key]);
  const activeStatusView = statusView !== 'all' && statusCounts[statusView] ? statusView : 'all';
  const visibleRows = activeStatusView === 'all' ? compareRows : compareRows.filter((row) => row.status === activeStatusView);
  const showDrilldown = Boolean(selectedRow && drilldownQuery.data);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tushum muammolari"
        description="Loyihadagi jonli tushumlar bilan moliya faylidagi snapshotni solishtirish uchun admin sahifa."
        actions={(
          <label className="btn btn-primary cursor-pointer">
            <IconUpload className="h-4 w-4" stroke={1.8} />
            Excel fayl yuklash
            <input type="file" accept=".xls,.xlsx" className="hidden" onChange={handleFileUpload} />
          </label>
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            aria-label="Boshlanish"
            className="field w-full rounded-full sm:w-[160px]"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            aria-label="Tugash"
            className="field w-full rounded-full sm:w-[160px]"
          />
          <div className="relative min-w-0 flex-1 basis-full sm:basis-64">
            <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Telefon yoki ism bo'yicha qidirish"
              aria-label="Telefon yoki ism bo'yicha qidirish"
              className="field rounded-full pl-10"
            />
          </div>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Status"
            className="field w-full rounded-full sm:w-[200px]"
          >
            <option value="">Barcha statuslar</option>
            <option value="matched">Mos</option>
            <option value="amount_mismatch">Summa farqi</option>
            <option value="count_mismatch">Soni farqi</option>
            <option value="only_in_db">Faqat bazada</option>
            <option value="only_in_finance">Faqat moliya faylida</option>
            <option value="ambiguous_match">Noaniq moslik</option>
          </select>
          <button type="button" onClick={handleCompare} className="btn btn-primary w-full sm:w-auto">
            <IconArrowsDiff className="h-4 w-4" stroke={1.8} />
            Solishtirish
          </button>
        </div>
      </PageHeader>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-5 px-5 py-5 sm:px-6 lg:flex-row lg:items-center">
          <div className="flex flex-shrink-0 items-center gap-3 lg:w-60">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <IconDatabase className="h-[18px] w-[18px]" stroke={1.6} />
            </span>
            <h2 className="section-title">Faol moliya snapshot</h2>
          </div>

          {activeSnapshotQuery.data?.exists ? (
            <dl className="grid min-w-0 flex-1 grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:border-l lg:border-gray-100 lg:pl-6 xl:grid-cols-4">
              <SnapshotFact label="Fayl:">{activeSnapshotQuery.data.workbookName}</SnapshotFact>
              <SnapshotFact label="Sheet:">{activeSnapshotQuery.data.sheetName}</SnapshotFact>
              <SnapshotFact label="Qatorlar:" mono>{activeSnapshotQuery.data.rowCount}</SnapshotFact>
              <SnapshotFact label="Faollashtirilgan vaqt:" mono>
                {activeSnapshotQuery.data.activatedAt ? new Date(activeSnapshotQuery.data.activatedAt).toLocaleString('uz-UZ') : '-'}
              </SnapshotFact>
            </dl>
          ) : (
            <EmptyState title="Hali snapshot saqlanmagan." icon={IconFileSpreadsheet} className="min-w-0 flex-1" />
          )}
        </div>

        {sheets.length > 0 && (
          <div className="space-y-5 border-t border-gray-100 px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <select
                value={selectedSheetName}
                onChange={(event) => setSelectedSheetName(event.target.value)}
                className="field md:flex-1"
              >
                {sheets.map((sheet) => (
                  <option key={sheet.name} value={sheet.name}>
                    {sheet.name} ({sheet.rows.length} qator)
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={handlePrepare} className="btn btn-secondary">
                  <IconEye className="h-4 w-4" stroke={1.8} />
                  Preview tayyorlash
                </button>
                <button type="button" onClick={handleActivate} className="btn btn-success">
                  <IconBolt className="h-4 w-4" stroke={1.8} />
                  Snapshotni faollashtirish
                </button>
              </div>
            </div>

            {prepareMutation.data && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 rounded-[16px] border border-gray-100 px-4 py-4 sm:grid-cols-3">
                  <MiniStat label="Jami qator" value={prepareMutation.data.totalRows} icon={IconTable} tone="bg-gray-100 text-gray-600" />
                  <MiniStat label="Normalizatsiya bo'lgan qator" value={prepareMutation.data.normalizedRowCount} icon={IconCircleCheck} tone="bg-emerald-50 text-emerald-600" />
                  <MiniStat label="Header qatori" value={prepareMutation.data.headerRowIndex + 1} icon={IconHash} tone="bg-blue-50 text-blue-600" />
                </div>

                <div className="panel-inset grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
                  {MAPPING_FIELDS.map((field) => (
                    <label key={field.key} className="block">
                      <span className="field-label">{field.label}</span>
                      <select
                        value={mappingState[field.key] || ''}
                        onChange={(event) => setMappingState((prev) => ({ ...prev, [field.key]: event.target.value }))}
                        className="field"
                      >
                        <option value="">Tanlanmagan</option>
                        {headerOptions.map((option) => (
                          <option key={`${field.key}-${option.value}`} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>

                {prepareMutation.data.errors.length > 0 && (
                  <div className="alert alert-warning space-y-0.5">
                    {prepareMutation.data.errors.slice(0, 8).map((item: string) => <div key={item}>{item}</div>)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {compareQuery.data && (
        <>
          <DifferenceHero
            dbTotal={compareQuery.data.summary.dbTotal}
            financeTotal={compareQuery.data.summary.financeTotal}
            differenceAmount={compareQuery.data.summary.differenceAmount}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile label="Mos mijozlar" value={compareQuery.data.summary.matchedCustomers} icon={IconCircleCheck} tone="green" />
            <StatTile label="Faqat bazada" value={compareQuery.data.summary.onlyInDbCustomers} icon={IconDatabase} tone="neutral" />
            <StatTile label="Faqat moliya faylida" value={compareQuery.data.summary.onlyInFinanceCustomers} icon={IconFileSpreadsheet} tone="neutral" />
            <StatTile label="Summa farqi" value={compareQuery.data.summary.amountMismatchCount} icon={IconAlertTriangle} tone="red" />
            <StatTile label="Noaniq moslik" value={compareQuery.data.summary.ambiguousMatchCount} icon={IconQuestionMark} tone="amber" />
          </div>

          <div className={`grid grid-cols-1 items-start gap-6 ${showDrilldown ? 'xl:grid-cols-[minmax(0,1fr)_420px]' : ''}`}>
            <section className="panel min-w-0 overflow-hidden">
              <div className="space-y-4 border-b border-gray-100 px-5 py-5 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h2 className="section-title">Muammolar</h2>
                    <span className="badge badge-neutral tabular">{compareQuery.data.rows.length}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleExport}
                    className="btn btn-soft btn-sm"
                  >
                    <IconDownload className="h-4 w-4" stroke={1.8} />
                    Muammolarni Excelga yuklab olish
                  </button>
                </div>

                {presentStatuses.length > 1 && (
                  <div className="-mx-1 overflow-x-auto px-1 pb-1">
                    <div className="segmented" role="group" aria-label="Status bo'yicha ko'rinish">
                      {['all', ...presentStatuses].map((key) => {
                        const active = activeStatusView === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setStatusView(key)}
                            className={`segmented-item inline-flex items-center gap-2 ${active ? 'segmented-item-active' : ''}`}
                          >
                            {key === 'all' ? 'Barcha statuslar' : statusLabels[key]}
                            <span className={`tabular text-xs ${active ? 'text-white/80' : 'text-gray-400'}`}>
                              {key === 'all' ? compareRows.length : statusCounts[key]}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-1 pb-2 sm:px-2">
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="text-left">Telefon</th>
                        <th className="text-left">Mijoz</th>
                        <th className="text-right">DB jami</th>
                        <th className="text-right">Moliya jami</th>
                        <th className="text-right">Farq</th>
                        <th className="text-right">DB soni</th>
                        <th className="text-right">Moliya soni</th>
                        <th className="text-left">Status</th>
                        <th className="text-right">Amal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row: any) => (
                        <tr key={row.matchId} className={selectedRow?.matchId === row.matchId ? 'bg-blue-50/60' : ''}>
                          <td className="tabular whitespace-nowrap text-gray-600">{row.phone || '-'}</td>
                          <td className="whitespace-nowrap font-medium text-gray-900">{row.name || '-'}</td>
                          <td className="tabular whitespace-nowrap text-right">{Number(row.dbTotalPaid).toLocaleString('uz-UZ')}</td>
                          <td className="tabular whitespace-nowrap text-right">{Number(row.financeTotalPaid).toLocaleString('uz-UZ')}</td>
                          <td className={`tabular whitespace-nowrap text-right font-medium ${Number(row.differenceAmount) === 0 ? 'text-gray-500' : 'text-amber-700'}`}>{Number(row.differenceAmount).toLocaleString('uz-UZ')}</td>
                          <td className="tabular text-right">{row.dbPaymentCount}</td>
                          <td className="tabular text-right">{row.financePaymentCount}</td>
                          <td className="whitespace-nowrap">
                            <span className={`badge ${STATUS_TONES[row.status] || 'badge-neutral'}`}>{statusLabels[row.status] || row.status}</span>
                          </td>
                          <td className="text-right">
                            <button type="button" onClick={() => handleOpenDrilldown(row)} className="btn btn-soft btn-sm">
                              Batafsil
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {showDrilldown && (
              <aside className="-m-1 space-y-4 p-1 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto">
                <DrilldownPanel title="Loyiha bazasi" icon={IconDatabase}>
                  {drilldownQuery.data!.dbRows.map((row: any) => (
                    <DrilldownRow key={row.id} row={row} />
                  ))}
                </DrilldownPanel>
                <DrilldownPanel title="Moliya snapshot" icon={IconFileSpreadsheet}>
                  {drilldownQuery.data!.financeRows.map((row: any) => (
                    <DrilldownRow key={`${row.rowIndex}-${row.paymentDate}-${row.customerPhone}`} row={row} />
                  ))}
                </DrilldownPanel>
              </aside>
            )}
          </div>
        </>
      )}

      {/* Drill-down for a row when the comparison table is not on screen (kept from the original layout). */}
      {!compareQuery.data && selectedRow && drilldownQuery.data && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <DrilldownPanel title="Loyiha bazasi" icon={IconDatabase}>
            {drilldownQuery.data.dbRows.map((row: any) => (
              <DrilldownRow key={row.id} row={row} />
            ))}
          </DrilldownPanel>
          <DrilldownPanel title="Moliya snapshot" icon={IconFileSpreadsheet}>
            {drilldownQuery.data.financeRows.map((row: any) => (
              <DrilldownRow key={`${row.rowIndex}-${row.paymentDate}-${row.customerPhone}`} row={row} />
            ))}
          </DrilldownPanel>
        </div>
      )}
    </div>
  );
}
