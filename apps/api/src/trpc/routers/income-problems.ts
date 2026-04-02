import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, router } from '../trpc';

type SnapshotMapping = {
  paymentDate: number | null;
  customerPhone: number | null;
  customerName: number | null;
  telegramUsername: number | null;
  managerLabel: number | null;
  courseName: number | null;
  tariffName: number | null;
  subTariffName: number | null;
  paymentType: number | null;
  agreementAmount: number | null;
  paymentAmount: number | null;
  remainingDebtAmount: number | null;
  deadline: number | null;
};

type FinanceSnapshotRow = {
  rowIndex: number;
  paymentDate: string | null;
  customerPhone: string;
  customerName: string;
  telegramUsername: string;
  managerLabel: string;
  courseName: string;
  tariffName: string;
  subTariffName: string;
  paymentType: string;
  agreementAmount: number;
  paymentAmount: number;
  remainingDebtAmount: number;
  deadline: string | null;
  normalizedPhone: string;
  normalizedName: string;
};

type ProjectComparisonRow = FinanceSnapshotRow & {
  id: string;
  lifecycleStatus: string;
};

type ActiveSnapshot = {
  version: 1;
  workbookName: string;
  sheetName: string;
  activatedAt: string;
  mapping: SnapshotMapping;
  rowCount: number;
  rows: FinanceSnapshotRow[];
};

type GroupSummary = {
  groupKey: string;
  phone: string;
  name: string;
  totalPaid: number;
  paymentCount: number;
  rows: Array<FinanceSnapshotRow | ProjectComparisonRow>;
};

const snapshotCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const snapshotMatrixSchema = z.array(z.array(snapshotCellSchema)).max(25000);
const mappingSchema = z.object({
  paymentDate: z.number().int().min(0).nullable(),
  customerPhone: z.number().int().min(0).nullable(),
  customerName: z.number().int().min(0).nullable(),
  telegramUsername: z.number().int().min(0).nullable(),
  managerLabel: z.number().int().min(0).nullable(),
  courseName: z.number().int().min(0).nullable(),
  tariffName: z.number().int().min(0).nullable(),
  subTariffName: z.number().int().min(0).nullable(),
  paymentType: z.number().int().min(0).nullable(),
  agreementAmount: z.number().int().min(0).nullable(),
  paymentAmount: z.number().int().min(0).nullable(),
  remainingDebtAmount: z.number().int().min(0).nullable(),
  deadline: z.number().int().min(0).nullable(),
});

const compareStatusSchema = z.enum([
  'matched',
  'amount_mismatch',
  'count_mismatch',
  'only_in_db',
  'only_in_finance',
  'ambiguous_match',
]);

const HEADER_ALIASES: Record<keyof SnapshotMapping, string[]> = {
  paymentDate: ["to'lov sanasi", 'tolov sanasi', 'sana', 'date', 'payment date'],
  customerPhone: ['telefon raqami', 'telefon', 'phone', 'raqam', 'mijoz raqami'],
  customerName: ['mijoz ism familiya', 'ism familiya', 'mijoz', 'ismi', 'customer name'],
  telegramUsername: ['telegram username', 'telegram', 'username', 'tg'],
  managerLabel: ['agent', 'operator', 'manager', 'menedjer', 'sotuv menejeri'],
  courseName: ['kurs turi', 'kurs', 'course'],
  tariffName: ['tarif', 'tariff'],
  subTariffName: ['subtarif', 'sub tarif', 'sub-tarif'],
  paymentType: ["to'lov turi", 'tolov turi', 'payment type', 'tur'],
  agreementAmount: ['kelishilgan narx', 'kelishuv summasi', 'agreement', 'narx'],
  paymentAmount: ["to'lov summasi", 'tolov summasi', 'payment amount', "to'lov"],
  remainingDebtAmount: ['qarzi', 'qarz', 'remaining debt', 'qoldiq qarz'],
  deadline: ['deadline', 'muddat'],
};

function asSettingsObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[’']/g, "'");
}

function normalizePhone(value: unknown): string {
  return String(value ?? '').replace(/\D+/g, '');
}

function normalizeName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseMoney(value: unknown): number {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\s+/g, '').replace(/,/g, '.').replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDateText(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const ddmmyyyy = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{4})/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseDateRange(dateFrom: string, dateTo: string) {
  const from = new Date(`${dateFrom}T00:00:00+05:00`);
  const to = new Date(`${dateTo}T23:59:59.999+05:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Davr sanalari noto‘g‘ri.' });
  }
  return { from, to };
}

function detectHeaderRow(rows: Array<Array<string | number | boolean | null>>): number {
  let bestIndex = 0;
  let bestScore = -1;
  for (let index = 0; index < Math.min(rows.length, 12); index += 1) {
    const normalized = (rows[index] || []).map((cell) => normalizeHeader(cell));
    let score = 0;
    for (const aliases of Object.values(HEADER_ALIASES)) {
      if (normalized.some((header) => aliases.some((alias) => header.includes(alias)))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function detectMapping(headers: string[]): SnapshotMapping {
  const result: SnapshotMapping = {
    paymentDate: null,
    customerPhone: null,
    customerName: null,
    telegramUsername: null,
    managerLabel: null,
    courseName: null,
    tariffName: null,
    subTariffName: null,
    paymentType: null,
    agreementAmount: null,
    paymentAmount: null,
    remainingDebtAmount: null,
    deadline: null,
  };

  (Object.keys(result) as Array<keyof SnapshotMapping>).forEach((field) => {
    const aliases = HEADER_ALIASES[field];
    const foundIndex = headers.findIndex((header) => aliases.some((alias) => header.includes(alias)));
    if (foundIndex >= 0) result[field] = foundIndex;
  });

  return result;
}

function getCell(row: Array<string | number | boolean | null>, index: number | null): unknown {
  return index == null ? '' : row[index] ?? '';
}

function normalizeFinanceRows(rows: Array<Array<string | number | boolean | null>>, mapping: SnapshotMapping): {
  normalizedRows: FinanceSnapshotRow[];
  errors: string[];
} {
  const normalizedRows: FinanceSnapshotRow[] = [];
  const errors: string[] = [];

  rows.forEach((row, rowIndex) => {
    const paymentDate = parseDateText(getCell(row, mapping.paymentDate));
    const customerPhone = String(getCell(row, mapping.customerPhone) ?? '').trim();
    const customerName = String(getCell(row, mapping.customerName) ?? '').trim();
    const normalizedPhone = normalizePhone(customerPhone);
    const normalizedName = normalizeName(customerName);
    const paymentAmount = parseMoney(getCell(row, mapping.paymentAmount));

    if (!paymentDate && !normalizedPhone && !normalizedName && paymentAmount === 0) {
      return;
    }
    if (!normalizedPhone && !normalizedName) {
      errors.push(`Qator ${rowIndex + 1}: mijoz telefoni yoki ismi topilmadi.`);
      return;
    }

    normalizedRows.push({
      rowIndex: rowIndex + 1,
      paymentDate,
      customerPhone,
      customerName,
      telegramUsername: String(getCell(row, mapping.telegramUsername) ?? '').trim(),
      managerLabel: String(getCell(row, mapping.managerLabel) ?? '').trim(),
      courseName: String(getCell(row, mapping.courseName) ?? '').trim(),
      tariffName: String(getCell(row, mapping.tariffName) ?? '').trim(),
      subTariffName: String(getCell(row, mapping.subTariffName) ?? '').trim(),
      paymentType: String(getCell(row, mapping.paymentType) ?? '').trim(),
      agreementAmount: parseMoney(getCell(row, mapping.agreementAmount)),
      paymentAmount,
      remainingDebtAmount: parseMoney(getCell(row, mapping.remainingDebtAmount)),
      deadline: parseDateText(getCell(row, mapping.deadline)),
      normalizedPhone,
      normalizedName,
    });
  });

  return { normalizedRows, errors };
}

async function readTenantSettings(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  if (!tenant) throw new TRPCError({ code: 'NOT_FOUND', message: 'Ish maydoni topilmadi.' });
  return asSettingsObject(tenant.settings);
}

async function writeTenantSettings(tenantId: string, settings: Record<string, unknown>) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: JSON.parse(JSON.stringify(settings)) },
  });
}

async function getActiveSnapshot(tenantId: string): Promise<ActiveSnapshot | null> {
  const settings = await readTenantSettings(tenantId);
  const incomeProblems = asSettingsObject(settings.incomeProblems);
  const activeSnapshot = incomeProblems.activeSnapshot;
  if (!activeSnapshot || typeof activeSnapshot !== 'object' || Array.isArray(activeSnapshot)) return null;
  return activeSnapshot as ActiveSnapshot;
}

async function loadProjectRows(tenantId: string, from: Date, to: Date): Promise<ProjectComparisonRow[]> {
  const incomes = await prisma.income.findMany({
    where: { tenantId, entryDate: { gte: from, lte: to } },
    orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
    include: {
      customer: { select: { customerNumber: true, name: true, telegramUsername: true, profileSubTariffId: true } },
      manager: { select: { name: true, username: true } },
      course: { select: { name: true } },
      tariff: { select: { name: true } },
    },
  });

  const subTariffIds = Array.from(new Set(incomes.map((income) => {
    const meta = income.legacyImportMeta as Record<string, unknown> | null;
    const value = typeof meta?.saleSubTariffId === 'string' ? meta.saleSubTariffId : income.customer?.profileSubTariffId || null;
    return value;
  }).filter((value): value is string => Boolean(value))));

  const subTariffNameById = new Map<string, string>();
  if (subTariffIds.length > 0) {
    const subTariffs = await prisma.subTariff.findMany({
      where: { tenantId, id: { in: subTariffIds } },
      select: { id: true, name: true },
    });
    subTariffs.forEach((row) => subTariffNameById.set(row.id, row.name));
  }

  return incomes.map((income) => {
    const meta = income.legacyImportMeta as Record<string, unknown> | null;
    const subTariffId = typeof meta?.saleSubTariffId === 'string' ? meta.saleSubTariffId : income.customer?.profileSubTariffId || null;
    return {
      id: income.id,
      rowIndex: 0,
      paymentDate: income.entryDate.toISOString().slice(0, 10),
      customerPhone: income.customer?.customerNumber || '',
      customerName: income.customer?.name || '',
      telegramUsername: income.customer?.telegramUsername || '',
      managerLabel: income.manager?.name || income.manager?.username || '',
      courseName: income.course?.name || '',
      tariffName: income.tariff?.name || '',
      subTariffName: subTariffId ? subTariffNameById.get(subTariffId) || '' : '',
      paymentType: income.type,
      agreementAmount: Number(income.coursePriceAmount ?? income.debtAmount ?? 0),
      paymentAmount: Number(income.paymentAmount ?? 0),
      remainingDebtAmount: Number(income.remainingDebtAmount ?? 0),
      deadline: income.deadline ? income.deadline.toISOString().slice(0, 10) : null,
      normalizedPhone: normalizePhone(income.customer?.customerNumber || ''),
      normalizedName: normalizeName(income.customer?.name || ''),
      lifecycleStatus: String(income.lifecycleStatus || ''),
    };
  });
}

function groupRows<T extends FinanceSnapshotRow | ProjectComparisonRow>(rows: T[]): Map<string, GroupSummary> {
  const map = new Map<string, GroupSummary>();
  for (const row of rows) {
    const key = row.normalizedPhone ? `phone:${row.normalizedPhone}` : `name:${row.normalizedName}`;
    const current = map.get(key) || {
      groupKey: key,
      phone: row.customerPhone,
      name: row.customerName,
      totalPaid: 0,
      paymentCount: 0,
      rows: [],
    };
    current.totalPaid += row.paymentAmount;
    current.paymentCount += 1;
    current.rows.push(row);
    if (!current.phone && row.customerPhone) current.phone = row.customerPhone;
    if (!current.name && row.customerName) current.name = row.customerName;
    map.set(key, current);
  }
  return map;
}

function summarizeComparisons(dbGroups: Map<string, GroupSummary>, financeGroups: Map<string, GroupSummary>) {
  const rows: Array<Record<string, unknown>> = [];
  const summary = {
    dbTotal: 0,
    financeTotal: 0,
    differenceAmount: 0,
    matchedCustomers: 0,
    onlyInDbCustomers: 0,
    onlyInFinanceCustomers: 0,
    amountMismatchCount: 0,
    ambiguousMatchCount: 0,
  };

  dbGroups.forEach((group) => { summary.dbTotal += group.totalPaid; });
  financeGroups.forEach((group) => { summary.financeTotal += group.totalPaid; });
  summary.differenceAmount = summary.dbTotal - summary.financeTotal;

  const matchedDb = new Set<string>();
  const matchedFinance = new Set<string>();

  for (const [key, dbGroup] of dbGroups.entries()) {
    if (!key.startsWith('phone:')) continue;
    const financeGroup = financeGroups.get(key);
    if (!financeGroup) continue;
    matchedDb.add(key);
    matchedFinance.add(key);
    const differenceAmount = dbGroup.totalPaid - financeGroup.totalPaid;
    const status = differenceAmount !== 0
      ? 'amount_mismatch'
      : dbGroup.paymentCount !== financeGroup.paymentCount
        ? 'count_mismatch'
        : 'matched';
    if (status === 'amount_mismatch') summary.amountMismatchCount += 1;
    if (status === 'matched') summary.matchedCustomers += 1;
    rows.push({
      matchId: key,
      phone: dbGroup.phone || financeGroup.phone,
      name: dbGroup.name || financeGroup.name,
      dbTotalPaid: dbGroup.totalPaid,
      financeTotalPaid: financeGroup.totalPaid,
      differenceAmount,
      dbPaymentCount: dbGroup.paymentCount,
      financePaymentCount: financeGroup.paymentCount,
      status,
      matchedBy: 'phone',
      dbGroupKeys: [key],
      financeGroupKeys: [key],
    });
  }

  const dbNameGroups = new Map<string, GroupSummary[]>();
  const financeNameGroups = new Map<string, GroupSummary[]>();
  dbGroups.forEach((group, key) => {
    if (matchedDb.has(key) || key.startsWith('phone:') || !group.rows[0]?.normalizedName) return;
    const nameKey = group.rows[0].normalizedName;
    dbNameGroups.set(nameKey, [...(dbNameGroups.get(nameKey) || []), group]);
  });
  financeGroups.forEach((group, key) => {
    if (matchedFinance.has(key) || key.startsWith('phone:') || !group.rows[0]?.normalizedName) return;
    const nameKey = group.rows[0].normalizedName;
    financeNameGroups.set(nameKey, [...(financeNameGroups.get(nameKey) || []), group]);
  });

  const allNameKeys = new Set([...dbNameGroups.keys(), ...financeNameGroups.keys()]);
  allNameKeys.forEach((nameKey) => {
    const dbList = dbNameGroups.get(nameKey) || [];
    const financeList = financeNameGroups.get(nameKey) || [];
    if (dbList.length === 1 && financeList.length === 1) {
      const dbGroup = dbList[0]!;
      const financeGroup = financeList[0]!;
      matchedDb.add(dbGroup.groupKey);
      matchedFinance.add(financeGroup.groupKey);
      const differenceAmount = dbGroup.totalPaid - financeGroup.totalPaid;
      const status = differenceAmount !== 0
        ? 'amount_mismatch'
        : dbGroup.paymentCount !== financeGroup.paymentCount
          ? 'count_mismatch'
          : 'matched';
      if (status === 'amount_mismatch') summary.amountMismatchCount += 1;
      if (status === 'matched') summary.matchedCustomers += 1;
      rows.push({
        matchId: `name:${nameKey}`,
        phone: dbGroup.phone || financeGroup.phone,
        name: dbGroup.name || financeGroup.name,
        dbTotalPaid: dbGroup.totalPaid,
        financeTotalPaid: financeGroup.totalPaid,
        differenceAmount,
        dbPaymentCount: dbGroup.paymentCount,
        financePaymentCount: financeGroup.paymentCount,
        status,
        matchedBy: 'name',
        dbGroupKeys: [dbGroup.groupKey],
        financeGroupKeys: [financeGroup.groupKey],
      });
      return;
    }

    if (dbList.length > 0 || financeList.length > 0) {
      summary.ambiguousMatchCount += Math.max(dbList.length, financeList.length);
      rows.push({
        matchId: `ambiguous:${nameKey}`,
        phone: dbList[0]?.phone || financeList[0]?.phone || '',
        name: dbList[0]?.name || financeList[0]?.name || '',
        dbTotalPaid: dbList.reduce((sum, group) => sum + group.totalPaid, 0),
        financeTotalPaid: financeList.reduce((sum, group) => sum + group.totalPaid, 0),
        differenceAmount: dbList.reduce((sum, group) => sum + group.totalPaid, 0) - financeList.reduce((sum, group) => sum + group.totalPaid, 0),
        dbPaymentCount: dbList.reduce((sum, group) => sum + group.paymentCount, 0),
        financePaymentCount: financeList.reduce((sum, group) => sum + group.paymentCount, 0),
        status: 'ambiguous_match',
        matchedBy: 'name',
        dbGroupKeys: dbList.map((group) => group.groupKey),
        financeGroupKeys: financeList.map((group) => group.groupKey),
      });
      dbList.forEach((group) => matchedDb.add(group.groupKey));
      financeList.forEach((group) => matchedFinance.add(group.groupKey));
    }
  });

  dbGroups.forEach((group, key) => {
    if (matchedDb.has(key)) return;
    summary.onlyInDbCustomers += 1;
    rows.push({
      matchId: `db:${key}`,
      phone: group.phone,
      name: group.name,
      dbTotalPaid: group.totalPaid,
      financeTotalPaid: 0,
      differenceAmount: group.totalPaid,
      dbPaymentCount: group.paymentCount,
      financePaymentCount: 0,
      status: 'only_in_db',
      matchedBy: 'phone',
      dbGroupKeys: [key],
      financeGroupKeys: [],
    });
  });

  financeGroups.forEach((group, key) => {
    if (matchedFinance.has(key)) return;
    summary.onlyInFinanceCustomers += 1;
    rows.push({
      matchId: `finance:${key}`,
      phone: group.phone,
      name: group.name,
      dbTotalPaid: 0,
      financeTotalPaid: group.totalPaid,
      differenceAmount: -group.totalPaid,
      dbPaymentCount: 0,
      financePaymentCount: group.paymentCount,
      status: 'only_in_finance',
      matchedBy: 'phone',
      dbGroupKeys: [],
      financeGroupKeys: [key],
    });
  });

  return { summary, rows: rows.sort((a, b) => Math.abs(Number(b.differenceAmount)) - Math.abs(Number(a.differenceAmount))) };
}

export const incomeProblemsRouter = router({
  getActiveSnapshot: adminProcedure.query(async ({ ctx }) => {
    const snapshot = await getActiveSnapshot(ctx.tenantId);
    return snapshot
      ? {
          exists: true,
          workbookName: snapshot.workbookName,
          sheetName: snapshot.sheetName,
          activatedAt: snapshot.activatedAt,
          rowCount: snapshot.rowCount,
          mapping: snapshot.mapping,
        }
      : { exists: false };
  }),

  uploadFinanceSnapshot: adminProcedure
    .input(z.object({
      workbookName: z.string().min(1).max(240),
      sheets: z.array(z.object({
        name: z.string().min(1).max(120),
        rowCount: z.number().int().min(0),
        headers: z.array(z.string()).max(50),
      })).min(1).max(50),
    }))
    .mutation(async ({ input }) => {
      const recommendedSheet = [...input.sheets]
        .sort((a, b) => {
          const score = (sheet: { headers: string[] }) => detectMapping(sheet.headers.map((header) => normalizeHeader(header))).paymentAmount != null ? 1 : 0;
          return score(b) - score(a) || b.rowCount - a.rowCount;
        })[0];
      return {
        workbookName: input.workbookName,
        sheets: input.sheets,
        recommendedSheetName: recommendedSheet?.name || input.sheets[0]?.name || null,
      };
    }),

  prepareFinanceSnapshot: adminProcedure
    .input(z.object({ workbookName: z.string().min(1).max(240), sheetName: z.string().min(1).max(120), rows: snapshotMatrixSchema, mapping: mappingSchema.partial().optional() }))
    .mutation(async ({ input }) => {
      const headerRowIndex = detectHeaderRow(input.rows);
      const headers = (input.rows[headerRowIndex] || []).map((cell) => String(cell ?? '').trim());
      const normalizedHeaders = headers.map((header) => normalizeHeader(header));
      const detectedMapping = detectMapping(normalizedHeaders);
      const mergedMapping = { ...detectedMapping, ...(input.mapping || {}) } as SnapshotMapping;
      const dataRows = input.rows.slice(headerRowIndex + 1);
      const { normalizedRows, errors } = normalizeFinanceRows(dataRows, mergedMapping);
      return {
        workbookName: input.workbookName,
        sheetName: input.sheetName,
        headerRowIndex,
        headers,
        mapping: mergedMapping,
        preview: normalizedRows.slice(0, 20),
        totalRows: dataRows.length,
        normalizedRowCount: normalizedRows.length,
        errors: errors.slice(0, 50),
      };
    }),

  activateFinanceSnapshot: adminProcedure
    .input(z.object({ workbookName: z.string().min(1).max(240), sheetName: z.string().min(1).max(120), rows: snapshotMatrixSchema, mapping: mappingSchema }))
    .mutation(async ({ ctx, input }) => {
      const { normalizedRows, errors } = normalizeFinanceRows(input.rows.slice(detectHeaderRow(input.rows) + 1), input.mapping);
      const settings = await readTenantSettings(ctx.tenantId);
      await writeTenantSettings(ctx.tenantId, {
        ...settings,
        incomeProblems: {
          ...asSettingsObject(settings.incomeProblems),
          activeSnapshot: {
            version: 1,
            workbookName: input.workbookName,
            sheetName: input.sheetName,
            activatedAt: new Date().toISOString(),
            mapping: input.mapping,
            rowCount: normalizedRows.length,
            rows: normalizedRows,
          },
        },
      });
      return { rowCount: normalizedRows.length, errors: errors.slice(0, 20) };
    }),

  compare: adminProcedure
    .input(z.object({ dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), search: z.string().trim().max(120).optional(), status: compareStatusSchema.optional() }))
    .query(async ({ ctx, input }) => {
      const snapshot = await getActiveSnapshot(ctx.tenantId);
      if (!snapshot) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Faol moliya snapshot yuklanmagan.' });
      const { from, to } = parseDateRange(input.dateFrom, input.dateTo);
      const projectRows = await loadProjectRows(ctx.tenantId, from, to);
      const financeRows = snapshot.rows.filter((row) => row.paymentDate && row.paymentDate >= input.dateFrom && row.paymentDate <= input.dateTo);
      const compared = summarizeComparisons(groupRows(projectRows), groupRows(financeRows));
      const search = normalizeName(input.search || '');
      const filteredRows = compared.rows.filter((row) => {
        if (input.status && row.status !== input.status) return false;
        if (!search) return true;
        return normalizeName(`${row.phone} ${row.name}`).includes(search);
      });
      return {
        snapshot: {
          workbookName: snapshot.workbookName,
          sheetName: snapshot.sheetName,
          activatedAt: snapshot.activatedAt,
          rowCount: snapshot.rowCount,
        },
        summary: compared.summary,
        rows: filteredRows,
      };
    }),

  customerDrilldown: adminProcedure
    .input(z.object({ dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dbGroupKeys: z.array(z.string()).max(20), financeGroupKeys: z.array(z.string()).max(20) }))
    .query(async ({ ctx, input }) => {
      const snapshot = await getActiveSnapshot(ctx.tenantId);
      if (!snapshot) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Faol moliya snapshot yuklanmagan.' });
      const { from, to } = parseDateRange(input.dateFrom, input.dateTo);
      const projectRows = await loadProjectRows(ctx.tenantId, from, to);
      const dbMap = groupRows(projectRows);
      const financeMap = groupRows(snapshot.rows.filter((row) => row.paymentDate && row.paymentDate >= input.dateFrom && row.paymentDate <= input.dateTo));
      return {
        dbRows: input.dbGroupKeys.flatMap((key) => dbMap.get(key)?.rows || []).sort((a, b) => String(a.paymentDate || '').localeCompare(String(b.paymentDate || ''))),
        financeRows: input.financeGroupKeys.flatMap((key) => financeMap.get(key)?.rows || []).sort((a, b) => String(a.paymentDate || '').localeCompare(String(b.paymentDate || ''))),
      };
    }),
});

