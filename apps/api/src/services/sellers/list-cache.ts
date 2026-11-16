import type { SellerRange } from './metrics';

export const SELLERS_LIST_CACHE_TTL_MS = 2 * 60 * 1000;

export const SELLERS_ACTIVITY_CACHE_TTL_MS = 10 * 60 * 1000;

type SellersListCacheEntry = {
  expiresAt: number;
  data: any[];
};

export const sellersListCache = new Map<string, SellersListCacheEntry>();

export function buildSellersListCacheKey(
  tenantId: string,
  scopedResponsibleUserId: string | null,
  pipelineIds: string[],
  range: SellerRange,
  corporateRevision: string,
  dateFrom?: string,
  dateTo?: string,
): string {
  return [
    tenantId,
    scopedResponsibleUserId || 'all',
    pipelineIds.slice().sort().join(','),
    range,
    corporateRevision,
    dateFrom || '',
    dateTo || '',
  ].join('|');
}
