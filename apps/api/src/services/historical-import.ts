import { createHash } from 'crypto';

export type HistoricalCourseCategory = 'online' | 'offline' | 'intensive' | 'additional_service';
export type HistoricalRawCell = string | number | boolean | null;
export type HistoricalRawRow = Record<string, HistoricalRawCell>;

export type HistoricalManagerLookup = {
  managersByKey: Record<string, string>;
  managersByNormalizedName: Array<{ id: string; name: string }>;
};

export type HistoricalCatalogLookup = {
  courses: Array<{
    name: string;
    category: HistoricalCourseCategory;
    tariffs: string[];
  }>;
  existingCustomerNumbers?: string[];
};

export type HistoricalImportFailure = {
  scope: 'income' | 'customer';
  rowNumber: number;
  message: string;
};

export type HistoricalCatalogItemPreview = {
  courseName: string;
  category: HistoricalCourseCategory;
  tariffs: string[];
  sources: Array<'income' | 'customer'>;
};

export type HistoricalPreparedIncomeRow = {
  rowNumber: number;
  legacyImportKey: string;
  type: 'new_sale' | 'repayment';
  entryDate: string;
  deadline: string | null;
  rawManagerValue: string;
  managerUserId: string | null;
  managerNeedsMapping: boolean;
  customerNumber: string;
  customerName: string | null;
  telegramUsername: string | null;
  rawCourseLabel: string;
  courseName: string;
  tariffName: string;
  category: HistoricalCourseCategory;
  coursePriceAmount: number | null;
  paymentAmount: number;
  remainingDebtHint: number | null;
  comment: string | null;
  blockingIssues: string[];
  matchedSaleLegacyKey: string | null;
  requiresOpeningBalance: boolean;
  openingBalanceLegacyKey: string | null;
  openingBalanceAmount: number | null;
};

export type HistoricalPreparedCustomerRow = {
  rowNumber: number;
  legacyProfileImportKey: string;
  customerNumber: string;
  customerName: string | null;
  telegramUsername: string | null;
  rawCourseLabel: string | null;
  rawTariffLabel: string | null;
  courseName: string | null;
  tariffName: string | null;
  category: HistoricalCourseCategory | null;
  comment: string | null;
  blockingIssues: string[];
  profileOnly: boolean;
};

export type HistoricalImportPreview = {
  canExecute: boolean;
  counts: {
    incomeTotalRows: number;
    incomeValidRows: number;
    incomeSkippedRows: number;
    incomeBlockedRows: number;
    customerTotalRows: number;
    customerValidRows: number;
    customerSkippedRows: number;
    customerBlockedRows: number;
    unresolvedManagerRows: number;
    profileOnlyCustomers: number;
    missingCourseCount: number;
    missingTariffCount: number;
    repaymentOpeningBalanceRows: number;
  };
  unresolvedManagers: Array<{
    label: string;
    rowCount: number;
    rowNumbers: number[];
  }>;
  missingCatalogItems: HistoricalCatalogItemPreview[];
  failures: HistoricalImportFailure[];
};

const TELEGRAM_USERNAME_REGEX = /^@?[A-Za-z0-9_]+$/;

const LEGACY_INCOME_EXACT_MAP: Record<string, { courseName: string; tariffName: string; category: HistoricalCourseCategory }> = {
  onlaynpremium: { courseName: 'Onlayn', tariffName: 'Premium', category: 'online' },
  onlaynstandart: { courseName: 'Onlayn', tariffName: 'Standart', category: 'online' },
  onlaynvip: { courseName: 'Onlayn', tariffName: 'VIP', category: 'online' },
  onlinepremium: { courseName: 'Onlayn', tariffName: 'Premium', category: 'online' },
  onlinestandart: { courseName: 'Onlayn', tariffName: 'Standart', category: 'online' },
  onlinevip: { courseName: 'Onlayn', tariffName: 'VIP', category: 'online' },
  oflaynpremium: { courseName: 'Oflayn', tariffName: 'Premium', category: 'offline' },
  oflaynstandart: { courseName: 'Oflayn', tariffName: 'Standart', category: 'offline' },
  oflaynvip: { courseName: 'Oflayn', tariffName: 'VIP', category: 'offline' },
  offlinepremium: { courseName: 'Oflayn', tariffName: 'Premium', category: 'offline' },
  offlinestandart: { courseName: 'Oflayn', tariffName: 'Standart', category: 'offline' },
  offlinevip: { courseName: 'Oflayn', tariffName: 'VIP', category: 'offline' },
  intensiv: { courseName: 'Intensiv', tariffName: 'Asosiy', category: 'intensive' },
  talaba: { courseName: 'Talaba', tariffName: 'Asosiy', category: 'additional_service' },
  korporativ: { courseName: 'Korporativ', tariffName: 'Asosiy', category: 'additional_service' },
  oquvquroli: { courseName: "O'quv quroli", tariffName: 'Asosiy', category: 'additional_service' },
  shaxsiykonsultatsiya: { courseName: 'Shaxsiy konsultatsiya', tariffName: 'Asosiy', category: 'additional_service' },
  togdarsi: { courseName: "Tog' darsi", tariffName: 'Asosiy', category: 'additional_service' },
  sayohat: { courseName: 'Sayohat', tariffName: 'Asosiy', category: 'additional_service' },
};

const HISTORICAL_INCOME_HEADERS = {
  entryDate: ["To'lov sanasi", 'entry_date', 'date'],
  manager: ['Operator', 'sales_manager', 'manager'],
  customerName: ['Ism Familiya', 'customer_name', 'name'],
  customerNumber: ['Telefon raqami', 'customer_number', 'phone'],
  telegramUsername: ['Telegram username', 'telegram_username', 'telegram'],
  courseLabel: ['Kurs turi', 'course', 'kurs'],
  type: ["To'lov turi", 'income_type', 'type'],
  agreementAmount: ['Kelishilgan narx', 'course_price', 'agreement'],
  paymentAmount: ["To'lov summasi", 'payment', 'payment_amount'],
  debtHint: ['Qarzi', 'debt', 'remaining_debt'],
  deadline: ['Deadline', 'deadline'],
  comment: ['Komment', 'comment', 'izoh'],
};

const HISTORICAL_CUSTOMER_HEADERS = {
  manager: ['Operator', 'sales_manager', 'manager'],
  customerName: ['Ism Familiya', 'customer_name', 'name'],
  customerNumber: ['Telefon raqami', 'customer_number', 'phone'],
  telegramUsername: ['Telegram username', 'telegram_username', 'telegram'],
  tariff: [' ', 'Tarif', 'Tariff', 'tarif', 'tariff'],
  courseLabel: ['Qaysi Couching', 'course', 'kurs'],
  comment: ['Komment', 'comment', 'izoh'],
};

function normalizeKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/['"`’]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function sanitizeCustomerNumber(value: string): string {
  return String(value || '').replace(/\s+/g, '').replace(/\D/g, '');
}

function sanitizeTelegramUsername(value: string): string {
  return String(value || '').replace(/\s+/g, '').replace(/[^A-Za-z0-9_@]/g, '');
}

function collapseWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function excelSerialToIso(serial: number): string {
  const epoch = Date.UTC(1899, 11, 30);
  const milliseconds = epoch + Math.round(serial * 86400000);
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function formatIsoParts(year: number, month: number, day: number): string | null {
  if (!year || !month || !day) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDateToIso(value: HistoricalRawCell | undefined): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1000 && value < 100000) {
      return excelSerialToIso(value);
    }
    return new Date(value).toISOString().slice(0, 10);
  }

  const raw = collapseWhitespace(String(value ?? ''));
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  let match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) {
      year += 2000;
    }
    return formatIsoParts(year, Number(match[2]), Number(match[1]));
  }

  match = raw.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})$/);
  if (match) {
    const monthMap: Record<string, number> = {
      jan: 1,
      january: 1,
      feb: 2,
      february: 2,
      mar: 3,
      march: 3,
      apr: 4,
      april: 4,
      may: 5,
      jun: 6,
      june: 6,
      jul: 7,
      july: 7,
      aug: 8,
      august: 8,
      sep: 9,
      sept: 9,
      september: 9,
      oct: 10,
      october: 10,
      nov: 11,
      november: 11,
      dec: 12,
      december: 12,
    };
    const monthToken = match[2] || '';
    const month = monthMap[monthToken.toLowerCase()];
    if (!month) {
      return null;
    }
    return formatIsoParts(Number(match[3]), month, Number(match[1]));
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
  }

  return null;
}

function parseAmountOrNull(value: HistoricalRawCell | undefined): number | null {
  const raw = collapseWhitespace(String(value ?? ''));
  if (!raw) {
    return null;
  }
  const digits = raw.replace(/[^\d-]/g, '');
  if (!digits || digits === '-') {
    return null;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function getRawValue(row: HistoricalRawRow, candidates: string[]): HistoricalRawCell | undefined {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, candidate)) {
      return row[candidate];
    }
  }

  const normalizedCandidates = new Set(candidates.map((candidate) => normalizeKey(candidate)));
  for (const [key, value] of Object.entries(row)) {
    if (normalizedCandidates.has(normalizeKey(key))) {
      return value;
    }
  }

  return undefined;
}

function getStringValue(row: HistoricalRawRow, candidates: string[]): string {
  const rawValue = getRawValue(row, candidates);
  if (rawValue === null || rawValue === undefined) {
    return '';
  }
  if (typeof rawValue === 'string') {
    return collapseWhitespace(rawValue);
  }
  if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
    return collapseWhitespace(String(rawValue));
  }
  return '';
}

function isEmptyRow(row: HistoricalRawRow): boolean {
  return Object.values(row).every((value) => collapseWhitespace(String(value ?? '')).length === 0);
}

function isIncomeHeaderLikeRow(row: HistoricalRawRow): boolean {
  const manager = normalizeKey(getStringValue(row, HISTORICAL_INCOME_HEADERS.manager));
  const customerNumber = normalizeKey(getStringValue(row, HISTORICAL_INCOME_HEADERS.customerNumber));
  const type = normalizeKey(getStringValue(row, HISTORICAL_INCOME_HEADERS.type));
  const course = normalizeKey(getStringValue(row, HISTORICAL_INCOME_HEADERS.courseLabel));
  return customerNumber === 'telefonraqami' || type === 'tolovturi' || course === 'kursturi' || (manager === 'operator' && customerNumber === 'telefonraqami');
}

function isCustomerHeaderLikeRow(row: HistoricalRawRow): boolean {
  const manager = normalizeKey(getStringValue(row, HISTORICAL_CUSTOMER_HEADERS.manager));
  const customerNumber = normalizeKey(getStringValue(row, HISTORICAL_CUSTOMER_HEADERS.customerNumber));
  const course = normalizeKey(getStringValue(row, HISTORICAL_CUSTOMER_HEADERS.courseLabel));
  return customerNumber === 'telefonraqami' || course === 'qaysicouching' || (manager === 'operator' && customerNumber === 'telefonraqami');
}

function buildHashKey(payload: Record<string, unknown>): string {
  return createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

function toDisplayLabel(value: string): string {
  return collapseWhitespace(value);
}

function normalizePaymentType(rawValue: string): 'new_sale' | 'repayment' | null {
  const key = normalizeKey(rawValue);
  if (!key) {
    return null;
  }
  if (key === 'qarzdorlik') {
    return 'repayment';
  }
  if (key === 'birinchitolov' || key === 'birinchtolov' || key === 'oxirgitolov') {
    return 'new_sale';
  }
  return null;
}

function normalizeIncomeCourseSpec(rawLabel: string): { courseName: string; tariffName: string; category: HistoricalCourseCategory } {
  const cleaned = toDisplayLabel(rawLabel);
  const key = normalizeKey(cleaned);
  const exact = LEGACY_INCOME_EXACT_MAP[key];
  if (exact) {
    return exact;
  }

  const onlinePrefix = cleaned.match(/^(onlayn|online)\s*[-/]\s*(.+)$/i);
  if (onlinePrefix) {
    return {
      courseName: 'Onlayn',
      tariffName: toDisplayLabel(onlinePrefix[2] || 'Asosiy'),
      category: 'online',
    };
  }

  const offlinePrefix = cleaned.match(/^(oflayn|offline)\s*[-/]\s*(.+)$/i);
  if (offlinePrefix) {
    return {
      courseName: 'Oflayn',
      tariffName: toDisplayLabel(offlinePrefix[2] || 'Asosiy'),
      category: 'offline',
    };
  }

  if (key.includes('intensiv')) {
    return {
      courseName: 'Intensiv',
      tariffName: 'Asosiy',
      category: 'intensive',
    };
  }

  return {
    courseName: cleaned,
    tariffName: 'Asosiy',
    category: 'additional_service',
  };
}

function inferProfileCourseCategory(rawCourseLabel: string): HistoricalCourseCategory {
  const key = normalizeKey(rawCourseLabel);
  if (key.includes('online') || key.includes('onlayn')) {
    return 'online';
  }
  if (key.includes('intensiv')) {
    return 'intensive';
  }
  if (key === 'sayohat' || key === 'obuna' || key === 'korporativ' || key === 'talaba' || key === 'oquvquroli' || key === 'shaxsiykonsultatsiya' || key === 'togdarsi') {
    return 'additional_service';
  }
  return 'offline';
}

function shouldSkipHistoricalCourseCategory(category: HistoricalCourseCategory | null): boolean {
  return category === 'additional_service';
}

function normalizeAliasMap(aliasMapInput: Record<string, string> | undefined): Record<string, string> {
  const aliasMap: Record<string, string> = {};
  for (const [label, userId] of Object.entries(aliasMapInput || {})) {
    const key = normalizeKey(label);
    if (!key || !userId) {
      continue;
    }
    aliasMap[key] = userId;
  }
  return aliasMap;
}

function resolveManagerUserId(params: {
  rawManagerValue: string;
  managerLookup: HistoricalManagerLookup;
  aliasMap: Record<string, string>;
  fallbackManagerUserId?: string;
}): { managerUserId: string | null; needsMapping: boolean } {
  const normalizedRawValue = normalizeKey(params.rawManagerValue);
  if (!normalizedRawValue) {
    return {
      managerUserId: params.fallbackManagerUserId || null,
      needsMapping: !params.fallbackManagerUserId,
    };
  }

  const exactMatch = params.managerLookup.managersByKey[normalizedRawValue];
  if (exactMatch) {
    return { managerUserId: exactMatch, needsMapping: false };
  }

  const aliasMatch = params.aliasMap[normalizedRawValue];
  if (aliasMatch) {
    return { managerUserId: aliasMatch, needsMapping: false };
  }

  const containsMatches = params.managerLookup.managersByNormalizedName.filter((manager) => manager.name.includes(normalizedRawValue) || normalizedRawValue.includes(manager.name));
  if (containsMatches.length === 1) {
    return { managerUserId: containsMatches[0]?.id || null, needsMapping: false };
  }

  if (params.fallbackManagerUserId) {
    return { managerUserId: params.fallbackManagerUserId, needsMapping: false };
  }

  return { managerUserId: null, needsMapping: true };
}

function parseIncomeRows(params: {
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
    const customerNumber = sanitizeCustomerNumber(getStringValue(rawRow, HISTORICAL_INCOME_HEADERS.customerNumber));
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

function parseCustomerRows(params: {
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

    const customerNumber = sanitizeCustomerNumber(getStringValue(rawRow, HISTORICAL_CUSTOMER_HEADERS.customerNumber));
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
  const existingCustomerNumbers = new Set((params.existingCatalog.existingCustomerNumbers || []).map((value) => sanitizeCustomerNumber(value)));

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
