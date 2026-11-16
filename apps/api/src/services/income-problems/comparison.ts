import type { DbClient } from '@dashboarduz/db';
import { normalizeDigits } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';

import { normalizeMatchText } from '../../lib/text';

import type { FinanceSnapshotRow } from './finance-snapshot';

type ProjectComparisonRow = FinanceSnapshotRow & {
  id: string;
  lifecycleStatus: string;
};

type GroupSummary = {
  groupKey: string;
  phone: string;
  name: string;
  totalPaid: number;
  paymentCount: number;
  rows: Array<FinanceSnapshotRow | ProjectComparisonRow>;
};

export function parseDateRange(dateFrom: string, dateTo: string) {
  const from = new Date(`${dateFrom}T00:00:00+05:00`);
  const to = new Date(`${dateTo}T23:59:59.999+05:00`);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Davr sanalari noto�g�ri.' });
  }

  return { from, to };
}

export async function loadProjectRows(tenantId: string, from: Date, to: Date, db: DbClient): Promise<ProjectComparisonRow[]> {
  const incomes = await db.income.findMany({
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
    const subTariffs = await db.subTariff.findMany({
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
      normalizedPhone: normalizeDigits(income.customer?.customerNumber || ''),
      normalizedName: normalizeMatchText(income.customer?.name || '', { collapseWhitespace: true }),
      lifecycleStatus: String(income.lifecycleStatus || ''),
    };
  });
}

export function groupRows<T extends FinanceSnapshotRow | ProjectComparisonRow>(rows: T[]): Map<string, GroupSummary> {
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

export function summarizeComparisons(dbGroups: Map<string, GroupSummary>, financeGroups: Map<string, GroupSummary>) {
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
