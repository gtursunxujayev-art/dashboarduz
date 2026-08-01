import type { Prisma } from '@prisma/client';

export const BONUS_DETAIL_EXPORT_LIMIT = 20_000;

export function buildBonusDetailIncomeWhere(params: {
  tenantId: string;
  managerUserIds: string[];
  rangeStart: Date;
  rangeEnd: Date;
  courseId?: string;
  technicalSaleIds?: string[];
}): Prisma.IncomeWhereInput {
  const technicalSaleIds = params.technicalSaleIds || [];
  return {
    tenantId: params.tenantId,
    lifecycleStatus: 'active',
    managerUserId: { in: params.managerUserIds },
    ...(params.courseId ? { courseId: params.courseId } : {}),
    entryDate: {
      gte: params.rangeStart,
      lte: params.rangeEnd,
    },
    ...(technicalSaleIds.length > 0
      ? {
          NOT: {
            OR: [
              { id: { in: technicalSaleIds } },
              { relatedDebtIncomeId: { in: technicalSaleIds } },
            ],
          },
        }
      : {}),
  };
}

export function isBonusDetailExportOverLimit(
  totalCount: number,
  limit = BONUS_DETAIL_EXPORT_LIMIT,
): boolean {
  return totalCount > limit;
}
