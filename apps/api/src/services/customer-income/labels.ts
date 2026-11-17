import type { DbClient } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';

import { DATE_RANGE_MESSAGES } from '../../lib/dates';
import { INCOME_LIFECYCLE_ACTIVE } from '../income-chain';

import { INCOME_LIFECYCLE_PENDING_REFUND, INCOME_LIFECYCLE_REFUNDED } from './constants';

export function resolveManagerLabel(
  manager: { id?: string | null; name?: string | null; username?: string | null } | null | undefined,
  fallbackId?: string | null,
): string {
  const candidate = manager?.name || manager?.username || manager?.id || fallbackId || null;

  return candidate ? String(candidate) : '-';
}

export function getIncomeLifecycleLabel(status: string): string {
  if (status === INCOME_LIFECYCLE_PENDING_REFUND) {
    return 'pending_refund';
  }
  if (status === INCOME_LIFECYCLE_REFUNDED) {
    return 'refunded';
  }

  return INCOME_LIFECYCLE_ACTIVE;
}

export function parseDateInput(input: string): Date {
  const value = input.trim();
  // Date-only input is a Tashkent calendar day; never depend on the server's timezone.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000+05:00`)
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: DATE_RANGE_MESSAGES.invalidDate(value) });
  }

  return date;
}

export async function fetchLatestResponsibleManagerByCustomer(params: {
  tenantId: string;
  customerIds: string[];
  scopedManagerUserId?: string | null;
  db: DbClient;
}): Promise<Map<string, { managerUserId: string | null; managerLabel: string | null }>> {
  const { db } = params;

  if (!params.customerIds.length) {
    return new Map();
  }

  const latestIncomes = await db.income.findMany({
    where: {
      tenantId: params.tenantId,
      customerId: { in: params.customerIds },
      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      ...(params.scopedManagerUserId
        ? {
            managerUserId: params.scopedManagerUserId,
          }
        : {}),
    },
    orderBy: [
      { entryDate: 'desc' },
      { createdAt: 'desc' },
    ],
    select: {
      customerId: true,
      managerUserId: true,
      manager: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
    },
  });

  const result = new Map<string, { managerUserId: string | null; managerLabel: string | null }>();

  for (const income of latestIncomes) {
    if (result.has(income.customerId)) {
      continue;
    }
    const managerLabel = income.manager?.name || income.manager?.username || income.managerUserId || null;

    result.set(income.customerId, {
      managerUserId: income.managerUserId || null,
      managerLabel,
    });
  }

  return result;
}
