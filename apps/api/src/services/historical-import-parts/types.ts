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

export const TELEGRAM_USERNAME_REGEX = /^@?[A-Za-z0-9_]+$/;

export const LEGACY_INCOME_EXACT_MAP: Record<string, { courseName: string; tariffName: string; category: HistoricalCourseCategory }> = {
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

export const HISTORICAL_INCOME_HEADERS = {
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

export const HISTORICAL_CUSTOMER_HEADERS = {
  manager: ['Operator', 'sales_manager', 'manager'],
  customerName: ['Ism Familiya', 'customer_name', 'name'],
  customerNumber: ['Telefon raqami', 'customer_number', 'phone'],
  telegramUsername: ['Telegram username', 'telegram_username', 'telegram'],
  tariff: [' ', 'Tarif', 'Tariff', 'tarif', 'tariff'],
  courseLabel: ['Qaysi Couching', 'course', 'kurs'],
  comment: ['Komment', 'comment', 'izoh'],
};
