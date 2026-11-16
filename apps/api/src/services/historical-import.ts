import { normalizeDigits } from '@dashboarduz/shared';

import { normalizeKey } from '../lib/text';

import { parseCustomerRows, parseIncomeRows } from './historical-import-parts/rows';
import type { HistoricalCatalogItemPreview, HistoricalCatalogLookup, HistoricalCourseCategory, HistoricalImportPreview, HistoricalManagerLookup, HistoricalPreparedCustomerRow, HistoricalPreparedIncomeRow, HistoricalRawRow } from './historical-import-parts/types';
import { normalizeAliasMap } from './historical-import-parts/values';

export { type HistoricalCourseCategory, type HistoricalRawCell, type HistoricalRawRow, type HistoricalManagerLookup, type HistoricalCatalogLookup, type HistoricalImportFailure, type HistoricalCatalogItemPreview, type HistoricalPreparedIncomeRow, type HistoricalPreparedCustomerRow, type HistoricalImportPreview } from './historical-import-parts/types';

function buildMissingCatalogItems(params: {
  incomeRows: HistoricalPreparedIncomeRow[];
  customerRows: HistoricalPreparedCustomerRow[];
  existingCatalog: HistoricalCatalogLookup;
}): HistoricalCatalogItemPreview[] {
  const requirements = new Map<string, {
    courseName: string;
    category: HistoricalCourseCategory;
    tariffs: Set<string>;
    sources: Set<'income' | 'customer'>;
  }>();

  for (const row of params.incomeRows) {
    if (row.blockingIssues.length > 0) {
      continue;
    }
    const key = normalizeKey(row.courseName);

    if (!key) {
      continue;
    }
    const current = requirements.get(key) || {
      courseName: row.courseName,
      category: row.category,
      tariffs: new Set<string>(),
      sources: new Set<'income' | 'customer'>(),
    };

    current.tariffs.add(row.tariffName);
    current.sources.add('income');
    requirements.set(key, current);
  }

  for (const row of params.customerRows) {
    if (row.blockingIssues.length > 0 || !row.courseName || !row.category) {
      continue;
    }
    const key = normalizeKey(row.courseName);

    if (!key) {
      continue;
    }
    const current = requirements.get(key) || {
      courseName: row.courseName,
      category: row.category,
      tariffs: new Set<string>(),
      sources: new Set<'income' | 'customer'>(),
    };

    if (row.tariffName) {
      current.tariffs.add(row.tariffName);
    }
    current.sources.add('customer');
    requirements.set(key, current);
  }

  const existingCourses = new Map<string, { category: HistoricalCourseCategory; tariffs: Set<string> }>();

  for (const course of params.existingCatalog.courses) {
    existingCourses.set(normalizeKey(course.name), {
      category: course.category,
      tariffs: new Set(course.tariffs.map((tariff) => normalizeKey(tariff))),
    });
  }

  const missingItems: HistoricalCatalogItemPreview[] = [];

  for (const requirement of requirements.values()) {
    const existing = existingCourses.get(normalizeKey(requirement.courseName));

    if (!existing) {
      missingItems.push({
        courseName: requirement.courseName,
        category: requirement.category,
        tariffs: Array.from(requirement.tariffs).sort((left, right) => left.localeCompare(right)),
        sources: Array.from(requirement.sources),
      });
      continue;
    }

    const missingTariffs = Array.from(requirement.tariffs)
      .filter((tariffName) => !existing.tariffs.has(normalizeKey(tariffName)))
      .sort((left, right) => left.localeCompare(right));

    if (missingTariffs.length > 0) {
      missingItems.push({
        courseName: requirement.courseName,
        category: existing.category,
        tariffs: missingTariffs,
        sources: Array.from(requirement.sources),
      });
    }
  }

  missingItems.sort((left, right) => left.courseName.localeCompare(right.courseName));

  return missingItems;
}

export function prepareHistoricalImportPreview(params: {
  incomeRows: HistoricalRawRow[];
  customerRows: HistoricalRawRow[];
  managerLookup: HistoricalManagerLookup;
  existingCatalog: HistoricalCatalogLookup;
  fallbackManagerUserId?: string;
  managerAliasMap?: Record<string, string>;
}): {
  incomeRows: HistoricalPreparedIncomeRow[];
  customerRows: HistoricalPreparedCustomerRow[];
  preview: HistoricalImportPreview;
  managerAliasMap: Record<string, string>;
} {
  const aliasMap = normalizeAliasMap(params.managerAliasMap);

  const parsedIncome = parseIncomeRows({
    incomeRows: params.incomeRows,
    managerLookup: params.managerLookup,
    aliasMap,
    fallbackManagerUserId: params.fallbackManagerUserId,
  });

  const incomeCustomerNumbers = new Set(parsedIncome.rows.map((row) => row.customerNumber).filter(Boolean));
  const existingCustomerNumbers = new Set((params.existingCatalog.existingCustomerNumbers || []).map((value) => normalizeDigits(value)));

  const parsedCustomers = parseCustomerRows({
    customerRows: params.customerRows,
    incomeCustomerNumbers,
    existingCustomerNumbers,
  });

  const unresolvedManagersMap = new Map<string, { label: string; rowNumbers: number[] }>();

  for (const row of parsedIncome.rows) {
    if (!row.managerNeedsMapping) {
      continue;
    }
    const label = row.rawManagerValue || '(bosh)';
    const current = unresolvedManagersMap.get(label) || { label, rowNumbers: [] };

    current.rowNumbers.push(row.rowNumber);
    unresolvedManagersMap.set(label, current);
  }

  const unresolvedManagers = Array.from(unresolvedManagersMap.values())
    .map((entry) => ({
      label: entry.label,
      rowCount: entry.rowNumbers.length,
      rowNumbers: entry.rowNumbers.slice(0, 20),
    }))
    .sort((left, right) => right.rowCount - left.rowCount || left.label.localeCompare(right.label));

  const missingCatalogItems = buildMissingCatalogItems({
    incomeRows: parsedIncome.rows,
    customerRows: parsedCustomers.rows,
    existingCatalog: params.existingCatalog,
  });

  const previewFailures = [...parsedIncome.failures, ...parsedCustomers.failures].sort((left, right) => {
    if (left.scope !== right.scope) {
      return left.scope.localeCompare(right.scope);
    }

    return left.rowNumber - right.rowNumber;
  });
  const incomeValidRows = parsedIncome.rows.filter((row) => row.blockingIssues.length === 0).length;
  const customerValidRows = parsedCustomers.rows.filter((row) => row.blockingIssues.length === 0).length;

  const preview: HistoricalImportPreview = {
    canExecute: unresolvedManagers.length === 0 && (incomeValidRows + customerValidRows) > 0,
    counts: {
      incomeTotalRows: params.incomeRows.length,
      incomeValidRows,
      incomeSkippedRows: parsedIncome.skippedCount,
      incomeBlockedRows: parsedIncome.rows.filter((row) => row.blockingIssues.length > 0).length,
      customerTotalRows: params.customerRows.length,
      customerValidRows,
      customerSkippedRows: parsedCustomers.skippedCount,
      customerBlockedRows: parsedCustomers.rows.filter((row) => row.blockingIssues.length > 0).length,
      unresolvedManagerRows: parsedIncome.rows.filter((row) => row.managerNeedsMapping).length,
      profileOnlyCustomers: parsedCustomers.rows.filter((row) => row.profileOnly).length,
      missingCourseCount: missingCatalogItems.length,
      missingTariffCount: missingCatalogItems.reduce((sum, item) => sum + item.tariffs.length, 0),
      repaymentOpeningBalanceRows: parsedIncome.rows.filter((row) => row.requiresOpeningBalance).length,
    },
    unresolvedManagers,
    missingCatalogItems,
    failures: previewFailures,
  };

  return {
    incomeRows: parsedIncome.rows,
    customerRows: parsedCustomers.rows,
    preview,
    managerAliasMap: aliasMap,
  };
}

export function buildHistoricalInitialProgress(params: {
  incomeRows: HistoricalPreparedIncomeRow[];
  customerRows: HistoricalPreparedCustomerRow[];
  preview: HistoricalImportPreview;
}): Record<string, unknown> {
  const totalIncomeRows = params.incomeRows.filter((row) => row.blockingIssues.length === 0).length;
  const totalCustomerRows = params.customerRows.filter((row) => row.blockingIssues.length === 0).length;
  const totalRows = totalIncomeRows + totalCustomerRows;

  return {
    stage: 'prepared',
    totalRows,
    processedRows: 0,
    importedRows: 0,
    failedRows: params.preview.failures.length,
    totalIncomeRows,
    processedIncomeRows: 0,
    importedIncomeRows: 0,
    importedNewSaleRows: 0,
    importedRepaymentRows: 0,
    totalCustomerRows,
    processedCustomerRows: 0,
    importedCustomerRows: 0,
    createdCustomers: 0,
    updatedCustomers: 0,
    profileOnlyCustomers: params.preview.counts.profileOnlyCustomers,
    skippedIncomeRows: params.preview.counts.incomeSkippedRows,
    skippedCustomerRows: params.preview.counts.customerSkippedRows,
    message: 'Tayyor',
  };
}
