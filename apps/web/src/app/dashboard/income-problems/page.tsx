'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';

type RawCell = string | number | boolean | null;
type SheetData = { name: string; rows: RawCell[][] };
type MappingState = Record<string, string>;

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

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white shadow dark:bg-slate-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Tushum muammolari</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            Loyihadagi jonli tushumlar bilan moliya faylidagi snapshotni solishtirish uchun admin sahifa.
          </p>
        </div>

        <div className="space-y-5 p-6">
          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
          {success && <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">{success}</div>}

          <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Faol moliya snapshot</h2>
                {activeSnapshotQuery.data?.exists ? (
                  <div className="mt-2 space-y-1 text-sm text-gray-600 dark:text-slate-300">
                    <p>Fayl: {activeSnapshotQuery.data.workbookName}</p>
                    <p>Sheet: {activeSnapshotQuery.data.sheetName}</p>
                    <p>Qatorlar: {activeSnapshotQuery.data.rowCount}</p>
                    <p>Faollashtirilgan vaqt: {activeSnapshotQuery.data.activatedAt ? new Date(activeSnapshotQuery.data.activatedAt).toLocaleString('uz-UZ') : '-'}</p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">Hali snapshot saqlanmagan.</p>
                )}
              </div>
              <label className="inline-flex cursor-pointer items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Excel fayl yuklash
                <input type="file" accept=".xls,.xlsx" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>

            {sheets.length > 0 && (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto]">
                  <select
                    value={selectedSheetName}
                    onChange={(event) => setSelectedSheetName(event.target.value)}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {sheets.map((sheet) => (
                      <option key={sheet.name} value={sheet.name}>
                        {sheet.name} ({sheet.rows.length} qator)
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={handlePrepare} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium dark:border-slate-600 dark:text-slate-100">
                    Preview tayyorlash
                  </button>
                  <button type="button" onClick={handleActivate} className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
                    Snapshotni faollashtirish
                  </button>
                </div>

                {prepareMutation.data && (
                  <div className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-slate-700">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700"><p className="text-xs text-gray-500">Jami qator</p><p className="mt-1 text-lg font-semibold">{prepareMutation.data.totalRows}</p></div>
                      <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700"><p className="text-xs text-gray-500">Normalizatsiya bo'lgan qator</p><p className="mt-1 text-lg font-semibold">{prepareMutation.data.normalizedRowCount}</p></div>
                      <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700"><p className="text-xs text-gray-500">Header qatori</p><p className="mt-1 text-lg font-semibold">{prepareMutation.data.headerRowIndex + 1}</p></div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {MAPPING_FIELDS.map((field) => (
                        <label key={field.key} className="space-y-1 text-sm">
                          <span className="font-medium text-gray-700 dark:text-slate-300">{field.label}</span>
                          <select
                            value={mappingState[field.key] || ''}
                            onChange={(event) => setMappingState((prev) => ({ ...prev, [field.key]: event.target.value }))}
                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
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
                      <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                        {prepareMutation.data.errors.slice(0, 8).map((item: string) => <div key={item}>{item}</div>)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_180px_1fr_220px_auto]">
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Telefon yoki ism bo'yicha qidirish" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">Barcha statuslar</option>
                <option value="matched">Mos</option>
                <option value="amount_mismatch">Summa farqi</option>
                <option value="count_mismatch">Soni farqi</option>
                <option value="only_in_db">Faqat bazada</option>
                <option value="only_in_finance">Faqat moliya faylida</option>
                <option value="ambiguous_match">Noaniq moslik</option>
              </select>
              <button type="button" onClick={handleCompare} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Solishtirish
              </button>
            </div>
            {compareQuery.data ? (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={handleExport}
                  className="rounded-md border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/20"
                >
                  Muammolarni Excelga yuklab olish
                </button>
              </div>
            ) : null}
          </div>

          {compareQuery.data && (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700"><p className="text-xs text-gray-500">DB jami</p><p className="mt-1 text-lg font-semibold">{Number(compareQuery.data.summary.dbTotal).toLocaleString('uz-UZ')}</p></div>
                <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700"><p className="text-xs text-gray-500">Moliya jami</p><p className="mt-1 text-lg font-semibold">{Number(compareQuery.data.summary.financeTotal).toLocaleString('uz-UZ')}</p></div>
                <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700"><p className="text-xs text-gray-500">Farq</p><p className="mt-1 text-lg font-semibold">{Number(compareQuery.data.summary.differenceAmount).toLocaleString('uz-UZ')}</p></div>
                <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700"><p className="text-xs text-gray-500">Mos mijozlar</p><p className="mt-1 text-lg font-semibold">{compareQuery.data.summary.matchedCustomers}</p></div>
                <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700"><p className="text-xs text-gray-500">Faqat bazada</p><p className="mt-1 text-lg font-semibold">{compareQuery.data.summary.onlyInDbCustomers}</p></div>
                <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700"><p className="text-xs text-gray-500">Faqat moliya faylida</p><p className="mt-1 text-lg font-semibold">{compareQuery.data.summary.onlyInFinanceCustomers}</p></div>
                <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700"><p className="text-xs text-gray-500">Summa farqi</p><p className="mt-1 text-lg font-semibold">{compareQuery.data.summary.amountMismatchCount}</p></div>
                <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700"><p className="text-xs text-gray-500">Noaniq moslik</p><p className="mt-1 text-lg font-semibold">{compareQuery.data.summary.ambiguousMatchCount}</p></div>
              </div>

              <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-slate-700">
                <div className="overflow-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                    <thead className="bg-gray-50 dark:bg-slate-800">
                      <tr>
                        {['Telefon', 'Mijoz', 'DB jami', 'Moliya jami', 'Farq', 'DB soni', 'Moliya soni', 'Status', 'Amal'].map((label) => (
                          <th key={label} className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
                      {compareQuery.data.rows.map((row: any) => (
                        <tr key={row.matchId}>
                          <td className="px-3 py-2 text-sm">{row.phone || '-'}</td>
                          <td className="px-3 py-2 text-sm">{row.name || '-'}</td>
                          <td className="px-3 py-2 text-sm">{Number(row.dbTotalPaid).toLocaleString('uz-UZ')}</td>
                          <td className="px-3 py-2 text-sm">{Number(row.financeTotalPaid).toLocaleString('uz-UZ')}</td>
                          <td className="px-3 py-2 text-sm font-medium">{Number(row.differenceAmount).toLocaleString('uz-UZ')}</td>
                          <td className="px-3 py-2 text-sm">{row.dbPaymentCount}</td>
                          <td className="px-3 py-2 text-sm">{row.financePaymentCount}</td>
                          <td className="px-3 py-2 text-sm">{statusLabels[row.status] || row.status}</td>
                          <td className="px-3 py-2 text-sm">
                            <button type="button" onClick={() => handleOpenDrilldown(row)} className="rounded-md border border-blue-300 px-3 py-1 text-blue-700 dark:border-blue-700 dark:text-blue-300">
                              Batafsil
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {selectedRow && drilldownQuery.data && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Loyiha bazasi</h3>
                <div className="mt-3 space-y-2 text-sm">
                  {drilldownQuery.data.dbRows.map((row: any) => (
                    <div key={row.id} className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
                      <div>{row.paymentDate || '-'} | {row.customerName || row.customerPhone}</div>
                      <div>{row.courseName} / {row.tariffName}{row.subTariffName ? ` / ${row.subTariffName}` : ''}</div>
                      <div>To'lov: {Number(row.paymentAmount).toLocaleString('uz-UZ')} | Kelishuv: {Number(row.agreementAmount).toLocaleString('uz-UZ')} | Qarz: {Number(row.remainingDebtAmount).toLocaleString('uz-UZ')}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Moliya snapshot</h3>
                <div className="mt-3 space-y-2 text-sm">
                  {drilldownQuery.data.financeRows.map((row: any) => (
                    <div key={`${row.rowIndex}-${row.paymentDate}-${row.customerPhone}`} className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
                      <div>{row.paymentDate || '-'} | {row.customerName || row.customerPhone}</div>
                      <div>{row.courseName} / {row.tariffName}{row.subTariffName ? ` / ${row.subTariffName}` : ''}</div>
                      <div>To'lov: {Number(row.paymentAmount).toLocaleString('uz-UZ')} | Kelishuv: {Number(row.agreementAmount).toLocaleString('uz-UZ')} | Qarz: {Number(row.remainingDebtAmount).toLocaleString('uz-UZ')}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}



