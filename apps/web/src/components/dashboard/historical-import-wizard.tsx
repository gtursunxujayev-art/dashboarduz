'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { trpc } from '@/lib/trpc';

type RawImportCell = string | number | boolean | null;
type RawImportRow = Record<string, RawImportCell>;

type ManagerOption = {
  id: string;
  label: string;
};

type Props = {
  managers: ManagerOption[];
  onImported?: () => Promise<void> | void;
};

const STORAGE_KEY = 'dashboarduz-historical-import-session';

function fieldClass(): string {
  return 'mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400';
}

function readWorkbookRows(workbook: XLSX.WorkBook, sheetName: string): RawImportRow[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return [];
  }
  return XLSX.utils.sheet_to_json<RawImportRow>(sheet, {
    defval: '',
    raw: false,
  });
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function HistoricalImportWizard({ managers, onImported }: Props) {
  const utils = trpc.useContext();
  const [incomeRows, setIncomeRows] = useState<RawImportRow[]>([]);
  const [customerRows, setCustomerRows] = useState<RawImportRow[]>([]);
  const [incomeFileName, setIncomeFileName] = useState('');
  const [incomeSheetName, setIncomeSheetName] = useState('');
  const [customerFileName, setCustomerFileName] = useState('');
  const [customerSheetName, setCustomerSheetName] = useState('');
  const [fallbackManagerUserId, setFallbackManagerUserId] = useState('');
  const [managerAliasMap, setManagerAliasMap] = useState<Record<string, string>>({});
  const [sessionId, setSessionId] = useState('');
  const [localPreview, setLocalPreview] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const completionHandledRef = useRef(false);

  useEffect(() => {
    const storedSessionId = window.localStorage.getItem(STORAGE_KEY);
    if (storedSessionId) {
      setSessionId(storedSessionId);
    }
  }, []);

  useEffect(() => {
    if (sessionId) {
      window.localStorage.setItem(STORAGE_KEY, sessionId);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [sessionId]);

  const progressQuery = trpc.customerIncome.getHistoricalImportProgress.useQuery(
    { sessionId },
    {
      enabled: Boolean(sessionId),
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  useEffect(() => {
    if (!sessionId) {
      return undefined;
    }
    const currentStatus = progressQuery.data?.status;
    if (currentStatus !== 'running' && currentStatus !== 'cancelling') {
      return undefined;
    }
    const timer = window.setInterval(() => {
      progressQuery.refetch().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [sessionId, progressQuery, progressQuery.data?.status]);

  useEffect(() => {
    if (!progressQuery.data) {
      return;
    }
    if (progressQuery.data.status === 'completed' && !completionHandledRef.current) {
      completionHandledRef.current = true;
      setSuccess("Tarixiy import muvaffaqiyatli yakunlandi.");
      if (onImported) {
        Promise.resolve(onImported()).catch(() => undefined);
      }
    }
    if (progressQuery.data.status === 'prepared') {
      completionHandledRef.current = false;
    }
  }, [onImported, progressQuery.data]);

  const prepareMutation = trpc.customerIncome.prepareHistoricalImport.useMutation();
  const executeMutation = trpc.customerIncome.executeHistoricalImport.useMutation();
  const cancelMutation = trpc.customerIncome.cancelHistoricalImport.useMutation();

  const preview = progressQuery.data?.preview || localPreview;
  const progress = progressQuery.data?.progress || null;
  const failureReport = progressQuery.data?.failureReport || [];
  const currentStatus = progressQuery.data?.status || '';
  const remoteErrorMessage = progressQuery.data?.errorMessage || null;

  const unresolvedManagers = useMemo(() => Array.isArray(preview?.unresolvedManagers) ? preview.unresolvedManagers : [], [preview]);
  const missingCatalogItems = useMemo(() => Array.isArray(preview?.missingCatalogItems) ? preview.missingCatalogItems : [], [preview]);
  const unresolvedManagersFullyMapped = useMemo(
    () =>
      unresolvedManagers.length > 0 &&
      unresolvedManagers.every((item: any) => Boolean(managerAliasMap[item.label])),
    [managerAliasMap, unresolvedManagers],
  );
  const canExecuteImport = Boolean(
    sessionId &&
      currentStatus !== 'running' &&
      (
        preview?.canExecute ||
        unresolvedManagersFullyMapped
      ),
  );

  const handleIncomeFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new Error("Income faylida sheet topilmadi.");
      }
      const rows = readWorkbookRows(workbook, firstSheetName);
      setIncomeRows(rows);
      setIncomeFileName(file.name);
      setIncomeSheetName(firstSheetName);
      setLocalPreview(null);
      setError(null);
      setSuccess(null);
    } catch (parseError: any) {
      setIncomeRows([]);
      setIncomeFileName('');
      setIncomeSheetName('');
      setError(parseError?.message || "Income faylini o'qib bo'lmadi.");
    }
  };

  const handleCustomerFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const targetSheetName = workbook.SheetNames.find((name) => name.trim().toLowerCase() === 'baza');
      if (!targetSheetName) {
        throw new Error("Customer faylida 'Baza' sheet topilmadi.");
      }
      const rows = readWorkbookRows(workbook, targetSheetName);
      setCustomerRows(rows);
      setCustomerFileName(file.name);
      setCustomerSheetName(targetSheetName);
      setLocalPreview(null);
      setError(null);
      setSuccess(null);
    } catch (parseError: any) {
      setCustomerRows([]);
      setCustomerFileName('');
      setCustomerSheetName('');
      setError(parseError?.message || "Customer faylini o'qib bo'lmadi.");
    }
  };

  const handlePrepare = async () => {
    if (!incomeRows.length || !customerRows.length) {
      setError('Ikkala tarixiy fayl ham yuklanishi kerak.');
      return;
    }
    setError(null);
    setSuccess(null);
    completionHandledRef.current = false;
    try {
      const result = await prepareMutation.mutateAsync({
        sessionId: sessionId || undefined,
        incomeFileName,
        customerFileName,
        customerSheetName,
        incomeRows,
        customerRows,
        fallbackManagerUserId: fallbackManagerUserId || undefined,
        managerAliasMap,
      });
      setSessionId(result.sessionId);
      setLocalPreview(result.preview);
      await progressQuery.refetch();
    } catch (prepareError: any) {
      setError(prepareError?.message || "Tarixiy import preview yaratilmadi.");
    }
  };

  const handleExecute = async () => {
    if (!sessionId) {
      setError('Avval preview tayyorlang.');
      return;
    }
    setError(null);
    setSuccess(null);
    completionHandledRef.current = false;
    try {
      let targetSessionId = sessionId;
      if (unresolvedManagersFullyMapped || !preview?.canExecute) {
        const refreshed = await prepareMutation.mutateAsync({
          sessionId,
          incomeFileName,
          customerFileName,
          customerSheetName,
          incomeRows,
          customerRows,
          fallbackManagerUserId: fallbackManagerUserId || undefined,
          managerAliasMap,
        });
        targetSessionId = refreshed.sessionId;
        setSessionId(refreshed.sessionId);
        setLocalPreview(refreshed.preview);
        if (!refreshed.preview?.canExecute) {
          await progressQuery.refetch();
          setError("Importni boshlashdan oldin previewdagi bloklovchi xatolarni ko'rib chiqing.");
          return;
        }
      }
      await executeMutation.mutateAsync({ sessionId: targetSessionId });
      await Promise.all([progressQuery.refetch(), utils.customerIncome.formOptions.invalidate(), utils.customerIncome.listIncomes.invalidate()]);
    } catch (executeError: any) {
      setError(executeError?.message || 'Tarixiy import ishga tushmadi.');
    }
  };

  const handleCancel = async () => {
    if (!sessionId) {
      return;
    }
    try {
      await cancelMutation.mutateAsync({ sessionId });
      await progressQuery.refetch();
    } catch (cancelError: any) {
      setError(cancelError?.message || "Importni bekor qilib bo'lmadi.");
    }
  };

  return (
    <div className="rounded-lg bg-white shadow dark:bg-slate-900">
      <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
        <h2 className="text-lg font-medium text-gray-900 dark:text-slate-100">Tarixiy ma'lumotlarni yuklash</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          `import income.xlsx` va `Couching ro'yhat.xlsx` (`Baza`) bo'yicha tarixiy tushum va mijoz ma'lumotlarini bosqichma-bosqich yuklang.
        </p>
      </div>

      <div className="space-y-4 p-6">
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
        {!error && remoteErrorMessage && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
            {remoteErrorMessage}
          </p>
        )}
        {success && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">{success}</p>}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className={`rounded-md border border-dashed p-4 text-sm ${incomeFileName ? 'border-emerald-300 bg-emerald-50/60 text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-950/20 dark:text-emerald-100' : 'border-gray-300 text-gray-700 dark:border-slate-600 dark:text-slate-200'}`}>
            <div className="font-medium">Income ledger fayli</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              {incomeFileName || 'import income.xlsx ni tanlang'}
            </div>
            <input type="file" accept=".xlsx,.xls" className="sr-only" onChange={handleIncomeFile} />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="inline-flex rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                Fayl tanlash
              </span>
              {incomeFileName ? (
                <span className="text-xs text-emerald-700 dark:text-emerald-300">
                  Yuklandi: {incomeSheetName || '-'} • {incomeRows.length} qator
                </span>
              ) : (
                <span className="text-xs text-gray-500 dark:text-slate-400">
                  Excel fayl tanlang
                </span>
              )}
            </div>
          </label>
          <label className={`rounded-md border border-dashed p-4 text-sm ${customerFileName ? 'border-emerald-300 bg-emerald-50/60 text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-950/20 dark:text-emerald-100' : 'border-gray-300 text-gray-700 dark:border-slate-600 dark:text-slate-200'}`}>
            <div className="font-medium">Customer master fayli</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              {customerFileName || "Couching ro'yhat.xlsx ni tanlang"}
            </div>
            <input type="file" accept=".xlsx,.xls" className="sr-only" onChange={handleCustomerFile} />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="inline-flex rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                Fayl tanlash
              </span>
              {customerFileName ? (
                <span className="text-xs text-emerald-700 dark:text-emerald-300">
                  Yuklandi: {customerSheetName || '-'} • {customerRows.length} qator
                </span>
              ) : (
                <span className="text-xs text-gray-500 dark:text-slate-400">
                  `Baza` sheetli Excel fayl tanlang
                </span>
              )}
            </div>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Zaxira menedjer</label>
            <select value={fallbackManagerUserId} onChange={(event) => setFallbackManagerUserId(event.target.value)} className={fieldClass()}>
              <option value="">Zaxira menedjer yo'q</option>
              {managers.map((manager) => (
                <option key={`historical-manager-${manager.id}`} value={manager.id}>
                  {manager.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Operator nomi topilmasa shu menedjer ishlatiladi.</p>
          </div>

          <div className="flex items-end gap-3">
            <button
              type="button"
              onClick={handlePrepare}
              disabled={prepareMutation.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {prepareMutation.isLoading ? 'Tayyorlanmoqda...' : 'Preview tayyorlash'}
            </button>
            {sessionId && (
              <button
                type="button"
                onClick={() => downloadJson(`historical-import-${sessionId}-failures.json`, failureReport)}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Xatolarni yuklab olish
              </button>
            )}
          </div>
        </div>

        {preview && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
              <div className="text-xs text-gray-500 dark:text-slate-400">Income qatorlar</div>
              <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-slate-100">{preview.counts?.incomeValidRows || 0}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400">Skip: {preview.counts?.incomeSkippedRows || 0} | Blok: {preview.counts?.incomeBlockedRows || 0}</div>
            </div>
            <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
              <div className="text-xs text-gray-500 dark:text-slate-400">Baza qatorlar</div>
              <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-slate-100">{preview.counts?.customerValidRows || 0}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400">Skip: {preview.counts?.customerSkippedRows || 0} | Blok: {preview.counts?.customerBlockedRows || 0}</div>
            </div>
            <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
              <div className="text-xs text-gray-500 dark:text-slate-400">Profile-only mijozlar</div>
              <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-slate-100">{preview.counts?.profileOnlyCustomers || 0}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400">Baza da bor, ledger da yo'q</div>
            </div>
            <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
              <div className="text-xs text-gray-500 dark:text-slate-400">Ochilish qarzi</div>
              <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-slate-100">{preview.counts?.repaymentOpeningBalanceRows || 0}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400">Auto opening balance</div>
            </div>
            <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
              <div className="text-xs text-gray-500 dark:text-slate-400">Manager mapping</div>
              <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-slate-100">{preview.counts?.unresolvedManagerRows || 0}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400">Mapping talab qiladigan qatorlar</div>
            </div>
            <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
              <div className="text-xs text-gray-500 dark:text-slate-400">Yangi katalog</div>
              <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-slate-100">{missingCatalogItems.length}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400">
                Kurs: {preview.counts?.missingCourseCount || 0} | Tarif: {preview.counts?.missingTariffCount || 0}
              </div>
            </div>
          </div>
        )}

        {unresolvedManagers.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-700/40 dark:bg-amber-950/20">
            <div className="text-sm font-medium text-amber-900 dark:text-amber-200">Manager mapping kerak</div>
            <div className="mt-1 text-xs text-amber-800 dark:text-amber-300">
              Barcha mappinglar tanlangach, `Importni boshlash` tugmasi preview ni yangilab, keyin importni ishga tushiradi.
            </div>
            <div className="mt-3 space-y-3">
              {unresolvedManagers.map((item: any) => (
                <div key={`alias-${item.label}`} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_240px]">
                  <div className="text-sm text-amber-900 dark:text-amber-100">
                    <div className="font-medium">{item.label}</div>
                    <div className="text-xs">Qatorlar: {item.rowNumbers?.join(', ')}{item.rowCount > (item.rowNumbers?.length || 0) ? ' ...' : ''}</div>
                  </div>
                  <select
                    value={managerAliasMap[item.label] || ''}
                    onChange={(event) => {
                      setManagerAliasMap((prev) => ({
                        ...prev,
                        [item.label]: event.target.value,
                      }));
                    }}
                    className={fieldClass()}
                  >
                    <option value="">Menedjerni tanlang</option>
                    {managers.map((manager) => (
                      <option key={`alias-option-${item.label}-${manager.id}`} value={manager.id}>
                        {manager.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {missingCatalogItems.length > 0 && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-4 dark:border-blue-700/40 dark:bg-blue-950/20">
            <div className="text-sm font-medium text-blue-900 dark:text-blue-200">Yaratiladigan katalog elementlari</div>
            <div className="mt-3 space-y-2 text-sm text-blue-900 dark:text-blue-100">
              {missingCatalogItems.slice(0, 20).map((item: any) => (
                <div key={`catalog-${item.courseName}`}>
                  <span className="font-medium">{item.courseName}</span> ({item.category}) - {Array.isArray(item.tariffs) && item.tariffs.length ? item.tariffs.join(', ') : 'Tarifsiz'}
                </div>
              ))}
              {missingCatalogItems.length > 20 && <div>...</div>}
            </div>
          </div>
        )}

        {progress && (
          <div className="rounded-md border border-gray-200 p-4 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-slate-100">Holat: {currentStatus || progress.stage}</div>
                <div className="text-xs text-gray-500 dark:text-slate-400">{progress.message || '-'}</div>
              </div>
              <div className="text-sm text-gray-700 dark:text-slate-200">
                {progress.processedRows || 0}/{progress.totalRows || 0}
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-gray-100 dark:bg-slate-800">
              <div
                className="h-2 rounded-full bg-blue-600 transition-all"
                style={{ width: `${progress.totalRows ? Math.min((progress.processedRows / progress.totalRows) * 100, 100) : 0}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-gray-600 dark:text-slate-400 md:grid-cols-4">
              <div>Income: {progress.processedIncomeRows || 0}/{progress.totalIncomeRows || 0}</div>
              <div>Customer: {progress.processedCustomerRows || 0}/{progress.totalCustomerRows || 0}</div>
              <div>Import: {progress.importedRows || 0}</div>
              <div>Xato: {progress.failedRows || 0}</div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
                <div className="text-xs text-gray-500 dark:text-slate-400">Yangi sotuvlar</div>
                <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-slate-100">{progress.importedNewSaleRows || 0}</div>
              </div>
              <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
                <div className="text-xs text-gray-500 dark:text-slate-400">Qarzdorliklar</div>
                <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-slate-100">{progress.importedRepaymentRows || 0}</div>
              </div>
              <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
                <div className="text-xs text-gray-500 dark:text-slate-400">Yaratilgan mijozlar</div>
                <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-slate-100">{progress.createdCustomers || 0}</div>
              </div>
              <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
                <div className="text-xs text-gray-500 dark:text-slate-400">Yangilangan profillar</div>
                <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-slate-100">{progress.updatedCustomers || 0}</div>
              </div>
              <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
                <div className="text-xs text-gray-500 dark:text-slate-400">Profile-only mijozlar</div>
                <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-slate-100">{progress.profileOnlyCustomers || 0}</div>
              </div>
              <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
                <div className="text-xs text-gray-500 dark:text-slate-400">Skip qatorlar</div>
                <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-slate-100">
                  {(progress.skippedIncomeRows || 0) + (progress.skippedCustomerRows || 0)}
                </div>
              </div>
            </div>
          </div>
        )}

        {Array.isArray(failureReport) && failureReport.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-700/40 dark:bg-red-950/20">
            <div className="text-sm font-medium text-red-900 dark:text-red-200">Xatolar</div>
            <div className="mt-2 space-y-1 text-xs text-red-800 dark:text-red-200">
              {failureReport.slice(0, 25).map((item: any, index: number) => (
                <div key={`failure-${index}`}>
                  {item.scope} / {item.rowNumber}: {item.message}
                </div>
              ))}
              {failureReport.length > 25 && <div>...</div>}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExecute}
            disabled={!canExecuteImport || executeMutation.isLoading}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {executeMutation.isLoading || currentStatus === 'running' ? 'Import ishlayapti...' : 'Importni boshlash'}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={!sessionId || (currentStatus !== 'running' && currentStatus !== 'prepared' && currentStatus !== 'cancelling')}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {cancelMutation.isLoading || currentStatus === 'cancelling' ? 'Bekor qilinmoqda...' : 'Importni bekor qilish'}
          </button>
        </div>
      </div>
    </div>
  );
}

