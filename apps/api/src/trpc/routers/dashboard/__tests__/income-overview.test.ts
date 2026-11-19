import { describe, expect, it } from '@jest/globals';

import { splitIncomeRows } from '../income-overview';

describe('income overview split', () => {
  it('adds up to all income: online, offline and everything else', () => {
    const split = splitIncomeRows([
      { amount: 179_565_000, category: 'online' },
      { amount: 195_400_000, category: 'offline' },
      { amount: 12_000_000, category: 'intensive' },
      { amount: 450_000, category: 'additional_service' },
      { amount: 6_400_000, category: 'other' },
    ]);

    expect(split).toEqual({ online: 179_565_000, offline: 195_400_000, other: 18_850_000 });
    expect(split.online + split.offline + split.other).toBe(393_815_000);
  });
});
