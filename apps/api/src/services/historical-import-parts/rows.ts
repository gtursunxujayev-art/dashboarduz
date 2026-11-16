import { normalizeDigits, sanitizeTelegramUsername } from '@dashboarduz/shared';

import { normalizeKey } from '../../lib/text';

import { HISTORICAL_CUSTOMER_HEADERS, HISTORICAL_INCOME_HEADERS, type HistoricalImportFailure, type HistoricalManagerLookup, type HistoricalPreparedCustomerRow, type HistoricalPreparedIncomeRow, type HistoricalRawRow, TELEGRAM_USERNAME_REGEX } from './types';
import { buildHashKey, getRawValue, getStringValue, inferProfileCourseCategory, isCustomerHeaderLikeRow, isEmptyRow, isIncomeHeaderLikeRow, normalizeIncomeCourseSpec, normalizePaymentType, parseAmountOrNull, parseDateToIso, resolveManagerUserId, shouldSkipHistoricalCourseCategory, toDisplayLabel } from './values';

export function parseIncomeRows(params: {
  incomeRows: HistoricalRawRow[];
  managerLookup: HistoricalManagerLookup;
  aliasMap: Record<string, string>;
  fallbackManagerUserId?: string;
}): { rows: HistoricalPreparedIncomeRow[]; skippedCount: number; failures: HistoricalImportFailure[] } {
  const parsedRows: HistoricalPreparedIncomeRow[] = [];
  const failures: HistoricalImportFailure[] = [];
  let skippedCount = 0;

  for (let index = 0; index < params.incomeRows.length; index += 1) {
    const rawRow = params.incomeRows[index] || {};
    const rowNumber = index + 2;

    if (isEmptyRow(rawRow) || isIncomeHeaderLikeRow(rawRow)) {
      skippedCount += 1;
      continue;
    }

    const rawManagerValue = getStringValue(rawRow, HISTORICAL_INCOME_HEADERS.manager);
    const customerNumber = normalizeDigits(getStringValue(rawRow, HISTORICAL_INCOME_HEADERS.customerNumber));
    const customerName = toDisplayLabel(getStringValue(rawRow, HISTORICAL_INCOME_HEADERS.customerName)) || null;
    const telegramUsernameRaw = sanitizeTelegramUsername(getStringValue(rawRow, HISTORICAL_INCOME_HEADERS.telegramUsername));
    const rawCourseLabel = toDisplayLabel(getStringValue(rawRow, HISTORICAL_INCOME_HEADERS.courseLabel));
    const courseSpec = rawCourseLabel ? normalizeIncomeCourseSpec(rawCourseLabel) : null;

    if (courseSpec && shouldSkipHistoricalCourseCategory(courseSpec.category)) {
      skippedCount += 1;
      continue;
    }
    const rawType = getStringValue(rawRow, HISTORICAL_INCOME_HEADERS.type);
    const entryDate = parseDateToIso(getRawValue(rawRow, HISTORICAL_INCOME_HEADERS.entryDate));
    const deadline = parseDateToIso(getRawValue(rawRow, HISTORICAL_INCOME_HEADERS.deadline));
    const paymentAmount = parseAmountOrNull(getRawValue(rawRow, HISTORICAL_INCOME_HEADERS.paymentAmount)) ?? 0;
    const coursePriceAmount = parseAmountOrNull(getRawValue(rawRow, HISTORICAL_INCOME_HEADERS.agreementAmount));
    const remainingDebtHint = parseAmountOrNull(getRawValue(rawRow, HISTORICAL_INCOME_HEADERS.debtHint));
    const comment = toDisplayLabel(getStringValue(rawRow, HISTORICAL_INCOME_HEADERS.comment)) || null;

    const type = normalizePaymentType(rawType);
    const blockingIssues: string[] = [];

    if (!entryDate) {
      blockingIssues.push('Sana topilmadi.');
    }
    if (!customerNumber) {
      blockingIssues.push('Mijoz raqami topilmadi.');
    }
    if (!type) {
      blockingIssues.push("To'lov turi aniqlanmadi.");
    }
    if (!rawCourseLabel) {
      blockingIssues.push('Kurs turi topilmadi.');
    }
    if (telegramUsernameRaw && !TELEGRAM_USERNAME_REGEX.test(telegramUsernameRaw)) {
      blockingIssues.push('Telegram username formati notogri.');
    }

    const managerResolution = resolveManagerUserId({
      rawManagerValue,
      managerLookup: params.managerLookup,
      aliasMap: params.aliasMap,
      fallbackManagerUserId: params.fallbackManagerUserId,
    });

    if (type === 'new_sale') {
      if ((coursePriceAmount ?? 0) <= 0) {
        blockingIssues.push('Kelishilgan narx musbat bolishi kerak.');
      }
      if (paymentAmount < 0) {
        blockingIssues.push("Tolov summasi manfiy bolishi mumkin emas.");
      }
    }

    if (type === 'repayment' && paymentAmount <= 0) {
      blockingIssues.push("Qarzdorlik tolovi 0 dan katta bolishi kerak.");
    }

    const resolvedCourseSpec = courseSpec || normalizeIncomeCourseSpec(rawCourseLabel || 'Qoshimcha xizmat');
    const legacyImportKey = buildHashKey({
      scope: 'income_ledger',
      rowNumber,
      entryDate,
      rawManagerValue,
      customerNumber,
      customerName,
      rawCourseLabel,
      rawType,
      coursePriceAmount,
      paymentAmount,
      remainingDebtHint,
      deadline,
      comment,
    });

    const preparedRow: HistoricalPreparedIncomeRow = {
      rowNumber,
      legacyImportKey,
      type: type || 'new_sale',
      entryDate: entryDate || '',
      deadline,
      rawManagerValue,
      managerUserId: managerResolution.managerUserId,
      managerNeedsMapping: managerResolution.needsMapping,
      customerNumber,
      customerName,
      telegramUsername: telegramUsernameRaw || null,
      rawCourseLabel,
      courseName: resolvedCourseSpec.courseName,
      tariffName: resolvedCourseSpec.tariffName,
      category: resolvedCourseSpec.category,
      coursePriceAmount,
      paymentAmount,
      remainingDebtHint,
      comment,
      blockingIssues,
      matchedSaleLegacyKey: null,
      requiresOpeningBalance: false,
      openingBalanceLegacyKey: null,
      openingBalanceAmount: null,
    };

    if (preparedRow.blockingIssues.length > 0) {
      for (const issue of preparedRow.blockingIssues) {
        failures.push({ scope: 'income', rowNumber, message: issue });
      }
    }

    parsedRows.push(preparedRow);
  }

  parsedRows.sort((left, right) => {
    if (left.entryDate !== right.entryDate) {
      return left.entryDate.localeCompare(right.entryDate);
    }

    return left.rowNumber - right.rowNumber;
  });

  type OpenSaleState = {
    legacyImportKey: string;
    remainingAmount: number;
    courseKey: string;
  };

  const openSalesByCustomer = new Map<string, OpenSaleState[]>();

  for (const row of parsedRows) {
    if (row.blockingIssues.length > 0) {
      continue;
    }

    const customerOpenSales = openSalesByCustomer.get(row.customerNumber) || [];
    const rowCourseKey = normalizeKey(`${row.courseName}:${row.tariffName}`);

    if (row.type === 'new_sale') {
      const remainingAmount = Math.max((row.coursePriceAmount ?? 0) - row.paymentAmount, 0);

      if (remainingAmount > 0) {
        customerOpenSales.push({
          legacyImportKey: row.legacyImportKey,
          remainingAmount,
          courseKey: rowCourseKey,
        });
        openSalesByCustomer.set(row.customerNumber, customerOpenSales);
      }
      continue;
    }

    let matchedIndex = -1;

    for (let index = customerOpenSales.length - 1; index >= 0; index -= 1) {
      if (customerOpenSales[index]?.courseKey === rowCourseKey && (customerOpenSales[index]?.remainingAmount || 0) > 0) {
        matchedIndex = index;
        break;
      }
    }

    if (matchedIndex < 0) {
      for (let index = customerOpenSales.length - 1; index >= 0; index -= 1) {
        if ((customerOpenSales[index]?.remainingAmount || 0) > 0) {
          matchedIndex = index;
          break;
        }
      }
    }

    if (matchedIndex >= 0) {
      const matched = customerOpenSales[matchedIndex] as OpenSaleState;

      row.matchedSaleLegacyKey = matched.legacyImportKey;
      matched.remainingAmount = Math.max(matched.remainingAmount - row.paymentAmount, 0);
      if (matched.remainingAmount <= 0) {
        customerOpenSales.splice(matchedIndex, 1);
      }
      openSalesByCustomer.set(row.customerNumber, customerOpenSales);
      continue;
    }

    if (row.remainingDebtHint !== null && row.remainingDebtHint >= 0) {
      const openingBalanceAmount = row.remainingDebtHint + row.paymentAmount;
      const openingBalanceLegacyKey = `opening_${row.legacyImportKey}`;

      row.requiresOpeningBalance = true;
      row.openingBalanceAmount = openingBalanceAmount;
      row.openingBalanceLegacyKey = openingBalanceLegacyKey;
      row.matchedSaleLegacyKey = openingBalanceLegacyKey;

      const remainingAfterRepayment = Math.max(openingBalanceAmount - row.paymentAmount, 0);

      if (remainingAfterRepayment > 0) {
        customerOpenSales.push({
          legacyImportKey: openingBalanceLegacyKey,
          remainingAmount: remainingAfterRepayment,
          courseKey: rowCourseKey,
        });
        openSalesByCustomer.set(row.customerNumber, customerOpenSales);
      }
      continue;
    }

    row.blockingIssues.push('Oldingi sotuv topilmadi va ochilish qarzi avtomatik yaratilolmadi.');
    failures.push({
      scope: 'income',
      rowNumber: row.rowNumber,
      message: 'Oldingi sotuv topilmadi va ochilish qarzi avtomatik yaratilolmadi.',
    });
  }

  return {
    rows: parsedRows,
    skippedCount,
    failures,
  };
}

export function parseCustomerRows(params: {
  customerRows: HistoricalRawRow[];
  incomeCustomerNumbers: Set<string>;
  existingCustomerNumbers: Set<string>;
}): { rows: HistoricalPreparedCustomerRow[]; skippedCount: number; failures: HistoricalImportFailure[] } {
  const parsedRows: HistoricalPreparedCustomerRow[] = [];
  const failures: HistoricalImportFailure[] = [];
  let skippedCount = 0;

  for (let index = 0; index < params.customerRows.length; index += 1) {
    const rawRow = params.customerRows[index] || {};
    const rowNumber = index + 2;

    if (isEmptyRow(rawRow) || isCustomerHeaderLikeRow(rawRow)) {
      skippedCount += 1;
      continue;
    }

    const customerNumber = normalizeDigits(getStringValue(rawRow, HISTORICAL_CUSTOMER_HEADERS.customerNumber));
    const customerName = toDisplayLabel(getStringValue(rawRow, HISTORICAL_CUSTOMER_HEADERS.customerName)) || null;
    const telegramUsernameRaw = sanitizeTelegramUsername(getStringValue(rawRow, HISTORICAL_CUSTOMER_HEADERS.telegramUsername));
    const rawCourseLabel = toDisplayLabel(getStringValue(rawRow, HISTORICAL_CUSTOMER_HEADERS.courseLabel)) || null;
    const rawTariffLabel = toDisplayLabel(getStringValue(rawRow, HISTORICAL_CUSTOMER_HEADERS.tariff)) || null;
    const comment = toDisplayLabel(getStringValue(rawRow, HISTORICAL_CUSTOMER_HEADERS.comment)) || null;
    const blockingIssues: string[] = [];

    if (!customerNumber) {
      skippedCount += 1;
      continue;
    }
    if (telegramUsernameRaw && !TELEGRAM_USERNAME_REGEX.test(telegramUsernameRaw)) {
      blockingIssues.push('Telegram username formati notogri.');
    }
    if (!customerName && !params.existingCustomerNumbers.has(customerNumber)) {
      blockingIssues.push('Mijoz ismi topilmadi.');
    }

    const courseName = rawCourseLabel ? toDisplayLabel(rawCourseLabel) : null;
    const tariffName = rawTariffLabel ? toDisplayLabel(rawTariffLabel) : null;
    const category = courseName ? inferProfileCourseCategory(courseName) : null;

    if (shouldSkipHistoricalCourseCategory(category)) {
      skippedCount += 1;
      continue;
    }
    const profileOnly = Boolean(customerNumber) && !params.incomeCustomerNumbers.has(customerNumber);
    const legacyProfileImportKey = buildHashKey({
      scope: 'customer_master',
      rowNumber,
      customerNumber,
      customerName,
      telegramUsernameRaw,
      rawCourseLabel,
      rawTariffLabel,
      comment,
    });

    const preparedRow: HistoricalPreparedCustomerRow = {
      rowNumber,
      legacyProfileImportKey,
      customerNumber,
      customerName,
      telegramUsername: telegramUsernameRaw || null,
      rawCourseLabel,
      rawTariffLabel,
      courseName,
      tariffName,
      category,
      comment,
      blockingIssues,
      profileOnly,
    };

    if (preparedRow.blockingIssues.length > 0) {
      for (const issue of preparedRow.blockingIssues) {
        failures.push({ scope: 'customer', rowNumber, message: issue });
      }
    }

    parsedRows.push(preparedRow);
  }

  return {
    rows: parsedRows,
    skippedCount,
    failures,
  };
}
