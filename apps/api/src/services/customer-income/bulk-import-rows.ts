import type { DbClient } from '@dashboarduz/db';
import { normalizeDigits, sanitizeTelegramUsername } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';

import { normalizeKey } from '../../lib/text';

import { buildLookupKey, buildNormalizedRow, type BulkIncomeRow, COURSE_HEADERS, COURSE_PRICE_HEADERS, type CreateIncomeInput, CUSTOMER_NAME_HEADERS, CUSTOMER_NUMBER_HEADERS, DEADLINE_HEADERS, DEBT_SOURCE_HEADERS, ENTRY_DATE_HEADERS, getRowValue, MANAGER_HEADERS, normalizeStringValue, parseAmountValue, parseDateValue, PAYMENT_HEADERS, resolveType, type RowLookupContext, SUB_TARIFF_HEADERS, TARIFF_HEADERS, TELEGRAM_HEADERS, TYPE_HEADERS } from './bulk-import-parsing';
import { CUSTOMER_NUMBER_REGEX, TELEGRAM_USERNAME_REGEX } from './constants';
import { hasSalesManagerRole } from './roles';

export async function buildRowLookupContext(tenantId: string, db: DbClient): Promise<RowLookupContext> {
  const [managers, courses] = await Promise.all([
    db.user.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        username: true,
        roles: true,
      },
    }),
    db.course.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
      select: {
        id: true,
        name: true,
        tariffs: {
          where: {
            isActive: true,
          },
          orderBy: {
            name: 'asc',
          },
          select: {
            id: true,
            name: true,
            subTariffs: {
              where: {
                isActive: true,
              },
              orderBy: {
                name: 'asc',
              },
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const managersByKey = new Map<string, string>();
  const aliasCandidates = new Map<string, Set<string>>();
  const managersByNormalizedName: Array<{ id: string; name: string }> = [];

  const addManagerAlias = (alias: string, managerId: string) => {
    const normalizedAlias = normalizeKey(alias);

    if (!normalizedAlias) {
      return;
    }
    const existing = aliasCandidates.get(normalizedAlias) ?? new Set<string>();

    existing.add(managerId);
    aliasCandidates.set(normalizedAlias, existing);
  };

  const managerRows = managers as Array<{
    id: string;
    name: string | null;
    username: string | null;
    roles: string[];
  }>;
  const availableManagersFiltered = managerRows.filter((manager) => hasSalesManagerRole(manager.roles));
  const availableManagers = availableManagersFiltered.length > 0 ? availableManagersFiltered : managerRows;

  for (const manager of availableManagers) {
    addManagerAlias(manager.id, manager.id);
    if (manager.username) {
      addManagerAlias(manager.username, manager.id);
    }
    if (manager.name) {
      addManagerAlias(manager.name, manager.id);
      const tokens = manager.name
        .split(/\s+/)
        .map((token: string) => token.trim())
        .filter(Boolean);

      for (const token of tokens) {
        addManagerAlias(token, manager.id);
      }
      managersByNormalizedName.push({
        id: manager.id,
        name: normalizeKey(manager.name),
      });
    }
  }

  for (const [alias, managerIds] of aliasCandidates.entries()) {
    if (managerIds.size === 1) {
      managersByKey.set(alias, [...managerIds][0] as string);
    }
  }

  const coursesByKey = new Map<string, string>();
  const tariffsByCourseIdAndKey = new Map<string, string>();
  const subTariffsByTariffIdAndKey = new Map<string, string>();
  const firstSubTariffIdByTariffId = new Map<string, string>();

  for (const course of courses) {
    coursesByKey.set(normalizeKey(course.id), course.id);
    coursesByKey.set(normalizeKey(course.name), course.id);

    for (const tariff of course.tariffs) {
      tariffsByCourseIdAndKey.set(buildLookupKey(course.id, tariff.id), tariff.id);
      tariffsByCourseIdAndKey.set(buildLookupKey(course.id, tariff.name), tariff.id);

      for (const subTariff of tariff.subTariffs) {
        subTariffsByTariffIdAndKey.set(buildLookupKey(tariff.id, subTariff.id), subTariff.id);
        subTariffsByTariffIdAndKey.set(buildLookupKey(tariff.id, subTariff.name), subTariff.id);
      }

      const firstSubTariff = tariff.subTariffs[0];

      if (firstSubTariff?.id) {
        firstSubTariffIdByTariffId.set(tariff.id, firstSubTariff.id);
      }
    }
  }

  return {
    managersByKey,
    managersByNormalizedName,
    coursesByKey,
    tariffsByCourseIdAndKey,
    subTariffsByTariffIdAndKey,
    firstSubTariffIdByTariffId,
  };
}

function resolveImportRowManagerUserId(params: {
  rawManagerValue: string;
  lookupContext: RowLookupContext;
  fallbackManagerUserId?: string;
  rowNumber: number;
}): string {
  const { rawManagerValue, lookupContext, fallbackManagerUserId, rowNumber } = params;
  const normalizedRawValue = normalizeKey(rawManagerValue);

  if (!normalizedRawValue) {
    if (fallbackManagerUserId) {
      return fallbackManagerUserId;
    }
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Row ${rowNumber}: sales manager is required.` });
  }

  const exactMatch = lookupContext.managersByKey.get(normalizedRawValue);

  if (exactMatch) {
    return exactMatch;
  }

  const containsMatches = lookupContext.managersByNormalizedName.filter((manager) =>
    manager.name.includes(normalizedRawValue) || normalizedRawValue.includes(manager.name),
  );

  if (containsMatches.length === 1) {
    return containsMatches[0]?.id as string;
  }

  if (fallbackManagerUserId) {
    return fallbackManagerUserId;
  }

  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: `Row ${rowNumber}: sales manager is missing or not found (${rawManagerValue || 'empty'})`,
  });
}

function parseBulkRowToCreateIncomeInput(
  rawRow: BulkIncomeRow,
  rowNumber: number,
  lookupContext: RowLookupContext,
  fallbackManagerUserId?: string,
): CreateIncomeInput {
  const row = buildNormalizedRow(rawRow);

  const managerRaw = normalizeStringValue(getRowValue(row, MANAGER_HEADERS));
  const managerUserId = resolveImportRowManagerUserId({
    rawManagerValue: managerRaw,
    lookupContext,
    fallbackManagerUserId,
    rowNumber,
  });

  const entryDate = parseDateValue(getRowValue(row, ENTRY_DATE_HEADERS));

  if (!entryDate) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Row ${rowNumber}: date is required.` });
  }

  const customerNumber = normalizeDigits(normalizeStringValue(getRowValue(row, CUSTOMER_NUMBER_HEADERS)));

  if (!customerNumber) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Row ${rowNumber}: customer number is required.` });
  }
  if (!CUSTOMER_NUMBER_REGEX.test(customerNumber)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Row ${rowNumber}: customer number must contain only digits.` });
  }

  const typeRaw = normalizeStringValue(getRowValue(row, TYPE_HEADERS));
  const type = resolveType(typeRaw);

  const customerName = normalizeStringValue(getRowValue(row, CUSTOMER_NAME_HEADERS)) || undefined;
  const telegramUsernameRaw = sanitizeTelegramUsername(normalizeStringValue(getRowValue(row, TELEGRAM_HEADERS)));

  if (telegramUsernameRaw && !TELEGRAM_USERNAME_REGEX.test(telegramUsernameRaw)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Row ${rowNumber}: telegram username contains invalid characters.`,
    });
  }
  const telegramUsername = telegramUsernameRaw || undefined;
  const deadline = parseDateValue(getRowValue(row, DEADLINE_HEADERS)) || undefined;
  const paymentAmount = parseAmountValue(getRowValue(row, PAYMENT_HEADERS));
  const debtSourceIncomeId = normalizeStringValue(getRowValue(row, DEBT_SOURCE_HEADERS)) || undefined;

  if (type === 'new_sale') {
    const courseRaw = normalizeStringValue(getRowValue(row, COURSE_HEADERS));
    const courseId = lookupContext.coursesByKey.get(normalizeKey(courseRaw));

    if (!courseId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Row ${rowNumber}: course is required and must match an active course.`,
      });
    }

    const tariffRaw = normalizeStringValue(getRowValue(row, TARIFF_HEADERS));
    const tariffId = lookupContext.tariffsByCourseIdAndKey.get(buildLookupKey(courseId, tariffRaw));

    if (!tariffId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Row ${rowNumber}: tariff is required and must match an active tariff for the selected course.`,
      });
    }

    const subTariffRaw = normalizeStringValue(getRowValue(row, SUB_TARIFF_HEADERS));
    let subTariffId: string | undefined;

    if (subTariffRaw) {
      subTariffId = lookupContext.subTariffsByTariffIdAndKey.get(buildLookupKey(tariffId, subTariffRaw));
      if (!subTariffId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Row ${rowNumber}: sub-tariff must match an active sub-tariff for the selected tariff.`,
        });
      }
    } else {
      subTariffId = lookupContext.firstSubTariffIdByTariffId.get(tariffId);
    }

    const coursePriceAmount = parseAmountValue(getRowValue(row, COURSE_PRICE_HEADERS));

    if (coursePriceAmount <= 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Row ${rowNumber}: course price must be greater than zero.`,
      });
    }

    return {
      entryDate,
      managerUserId,
      customerNumber,
      customerName,
      telegramUsername,
      type,
      courseId,
      tariffId,
      subTariffId,
      coursePriceAmount,
      paymentAmount,
      deadline,
    };
  }

  return {
    entryDate,
    managerUserId,
    customerNumber,
    customerName,
    telegramUsername,
    type,
    debtSourceIncomeId,
    paymentAmount,
    deadline,
  };
}
