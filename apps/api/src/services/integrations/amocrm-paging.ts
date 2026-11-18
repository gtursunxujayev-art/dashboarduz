/**
 * Paging over amoCRM list endpoints. Every list stops at the first page that has no `next` link or
 * is shorter than the page size, or after `maxPages` pages.
 */
import type { AmoCRMEvent, AmoCRMListLinks } from './amocrm-types';

/** One page of a list: its items and whether amoCRM links a next page. */
export type AmoPage<T> = { items: T[]; hasNext: boolean };

/** amoCRM accepts at most this many ids in `filter[created_by][]`. */
export const AMOCRM_MAX_CREATED_BY_IDS = 10;

/** `limit` (or `fallback` when not given / 0), kept within 1..`max`. */
export function clampAmoPageSize(limit: number | undefined, fallback: number, max: number): number {
  return Math.min(Math.max(limit || fallback, 1), max);
}

/** `maxPages` (or `fallback` when not given / 0), at least 1. */
export function resolveAmoMaxPages(maxPages: number | undefined, fallback: number): number {
  return Math.max(maxPages || fallback, 1);
}

/** A page from a list response: the embedded list (empty unless it is an array) and the next link. */
export function toAmoPage<T>(items: T[] | undefined, links: AmoCRMListLinks | undefined): AmoPage<T> {
  return {
    items: Array.isArray(items) ? items : [],
    hasNext: Boolean(links?.next?.href),
  };
}

/** Reads pages 1, 2, ... and concatenates their items (see the module comment for when it stops). */
export async function collectAmoPages<T>(
  pageSize: number,
  maxPages: number,
  fetchPage: (page: number) => Promise<AmoPage<T>>,
): Promise<T[]> {
  const items: T[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchPage(page);

    items.push(...result.items);
    if (!result.hasNext || result.items.length < pageSize) {
      break;
    }
  }

  return items;
}

/**
 * The distinct, non-empty user ids in chunks amoCRM accepts; `[undefined]` (one unfiltered request)
 * when there are none.
 */
export function chunkCreatedByIds(userIds: string[] | null | undefined): Array<string[] | undefined> {
  const distinct = Array.from(new Set((userIds || []).filter(Boolean)));

  if (!distinct.length) {
    return [undefined];
  }

  return Array.from(
    { length: Math.ceil(distinct.length / AMOCRM_MAX_CREATED_BY_IDS) },
    (_, index) => distinct.slice(index * AMOCRM_MAX_CREATED_BY_IDS, (index + 1) * AMOCRM_MAX_CREATED_BY_IDS),
  );
}

/** Drops events whose id was already seen (first one wins); events without an id are all kept. */
export function dedupeEventsById(events: AmoCRMEvent[]): AmoCRMEvent[] {
  const seenEventIds = new Set<string>();

  return events.filter((event) => {
    if (event.id === undefined || event.id === null) {
      return true;
    }
    const key = String(event.id);

    if (seenEventIds.has(key)) {
      return false;
    }
    seenEventIds.add(key);

    return true;
  });
}
