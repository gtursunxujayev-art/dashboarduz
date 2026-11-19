/**
 * Which sellers (amoCRM responsible users) a caller may see, from `resolveCallerDataScope`'s
 * `amoResponsibleIds`: `null` = every seller, otherwise only those ids (an empty list = none).
 */
export function isSellerInScope(amoResponsibleIds: readonly string[] | null, sellerId: string | null | undefined): boolean {
  if (amoResponsibleIds === null) return true;

  return Boolean(sellerId) && amoResponsibleIds.includes(sellerId as string);
}

/** The scope part of the sellers list cache key: `null` for everyone, else a stable list of the ids. */
export function sellerScopeCacheKey(amoResponsibleIds: readonly string[] | null): string | null {
  if (amoResponsibleIds === null) return null;
  if (amoResponsibleIds.length === 0) return '__unmapped__';

  return Array.from(new Set(amoResponsibleIds)).sort().join('|');
}
