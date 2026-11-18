import { amoJsonHeaders, hasEmbeddedList, rethrowAmoError, thrownMessage } from '../amocrm-http';
import {
  chunkCreatedByIds,
  clampAmoPageSize,
  collectAmoPages,
  dedupeEventsById,
  resolveAmoMaxPages,
  toAmoPage,
  type AmoPage,
} from '../amocrm-paging';

describe('amoCRM paging helpers', () => {
  it('clamps the page size and defaults missing or zero values', () => {
    expect(clampAmoPageSize(undefined, 250, 250)).toBe(250);
    expect(clampAmoPageSize(0, 100, 100)).toBe(100);
    expect(clampAmoPageSize(-5, 250, 250)).toBe(1);
    expect(clampAmoPageSize(900, 100, 100)).toBe(100);
    expect(clampAmoPageSize(30, 250, 250)).toBe(30);
    expect(resolveAmoMaxPages(undefined, 50)).toBe(50);
    expect(resolveAmoMaxPages(0, 100)).toBe(100);
    expect(resolveAmoMaxPages(-3, 100)).toBe(1);
    expect(resolveAmoMaxPages(7, 100)).toBe(7);
  });

  it('reads a page from a list response', () => {
    expect(toAmoPage([1, 2], { next: { href: 'https://x/next' } })).toEqual({ items: [1, 2], hasNext: true });
    expect(toAmoPage(undefined, { next: { href: '' } })).toEqual({ items: [], hasNext: false });
    expect(toAmoPage([3], undefined)).toEqual({ items: [3], hasNext: false });
  });

  describe('collectAmoPages', () => {
    function pages(...responses: Array<AmoPage<number>>) {
      const requested: number[] = [];
      const fetchPage = (page: number) => {
        requested.push(page);

        return Promise.resolve(responses[page - 1] ?? { items: [], hasNext: false });
      };

      return { requested, fetchPage };
    }

    it('stops after a page without a next link', async () => {
      const { requested, fetchPage } = pages({ items: [1, 2], hasNext: true }, { items: [3, 4], hasNext: false }, { items: [5, 6], hasNext: true });

      await expect(collectAmoPages(2, 10, fetchPage)).resolves.toEqual([1, 2, 3, 4]);
      expect(requested).toEqual([1, 2]);
    });

    it('stops after a short page even when a next link exists', async () => {
      const { requested, fetchPage } = pages({ items: [1, 2], hasNext: true }, { items: [3], hasNext: true }, { items: [4, 5], hasNext: true });

      await expect(collectAmoPages(2, 10, fetchPage)).resolves.toEqual([1, 2, 3]);
      expect(requested).toEqual([1, 2]);
    });

    it('stops at maxPages', async () => {
      const full = { items: [1], hasNext: true };
      const { requested, fetchPage } = pages(full, full, full, full);

      await expect(collectAmoPages(1, 3, fetchPage)).resolves.toEqual([1, 1, 1]);
      expect(requested).toEqual([1, 2, 3]);
    });
  });

  it('chunks distinct, non-empty created_by ids by 10', () => {
    expect(chunkCreatedByIds(null)).toEqual([undefined]);
    expect(chunkCreatedByIds(['', ''])).toEqual([undefined]);
    expect(chunkCreatedByIds(['1', '1', '2'])).toEqual([['1', '2']]);
    const ids = Array.from({ length: 21 }, (_, index) => String(index));

    expect(chunkCreatedByIds(ids).map((chunk) => chunk?.length)).toEqual([10, 10, 1]);
  });

  it('keeps the first event per id and every event without one', () => {
    expect(dedupeEventsById([
      { id: 1, type: 'a' },
      { type: 'no-id' },
      { id: '1', type: 'b' },
      { id: 2 },
      { type: 'no-id' },
      { id: 2, type: 'c' },
    ])).toEqual([{ id: 1, type: 'a' }, { type: 'no-id' }, { id: 2 }, { type: 'no-id' }]);
  });
});

describe('amoCRM http helpers', () => {
  it('sends the bearer token as JSON headers', () => {
    expect(amoJsonHeaders('abc')).toEqual({ Authorization: 'Bearer abc', 'Content-Type': 'application/json' });
  });

  it('reads the message property of thrown values as is', () => {
    expect(thrownMessage(new Error('boom'))).toBe('boom');
    expect(thrownMessage({ message: 42 })).toBe(42);
    expect(thrownMessage('text')).toBeUndefined();
    expect(thrownMessage(null)).toBeUndefined();
  });

  it('wraps a thrown value in a prefixed error', () => {
    expect(() => rethrowAmoError(new Error('inner'), 'log', 'Failed to fetch AmoCRM leads'))
      .toThrow(new Error('Failed to fetch AmoCRM leads: inner'));
    expect(() => rethrowAmoError('plain', 'log', 'Failed')).toThrow(new Error('Failed: undefined'));
  });

  it('checks for an embedded list by truthiness', () => {
    expect(hasEmbeddedList({ _embedded: { leads: [] } }, 'leads')).toBe(true);
    expect(hasEmbeddedList({ _embedded: { leads: null } }, 'leads')).toBe(false);
    expect(hasEmbeddedList({ _embedded: {} }, 'contacts')).toBe(false);
    expect(hasEmbeddedList({ _embedded: 'x' }, 'leads')).toBe(false);
    expect(hasEmbeddedList(null, 'leads')).toBe(false);
  });
});
