import { describe, expect, it } from '@jest/globals';
import { sortAgentsForBoard } from './leaderboard-ranking';

describe('original live leaderboard ranking', () => {
  it('uses overall income, sales, and name without considering course metrics', () => {
    const ranked = sortAgentsForBoard([
      {
        name: 'Ali',
        group: 'online' as const,
        income: 4_000_000,
        salesCount: 10,
        courseMetrics: [{ qualifyingIncome: 99_000_000, bonus: 9_900_000 }],
      },
      {
        name: 'Bobur',
        group: 'online' as const,
        income: 6_000_000,
        salesCount: 2,
        courseMetrics: [{ qualifyingIncome: 1, bonus: 1 }],
      },
      {
        name: 'Dilshod',
        group: 'offline' as const,
        income: 20_000_000,
        salesCount: 20,
        courseMetrics: [{ qualifyingIncome: 20_000_000, bonus: 2_000_000 }],
      },
    ], 'online');

    expect(ranked.map((agent) => agent.name)).toEqual(['Bobur', 'Ali']);
  });

  it('uses sales and then name as stable tie breakers', () => {
    const ranked = sortAgentsForBoard([
      { name: 'Zafar', group: 'online' as const, income: 5_000_000, salesCount: 3 },
      { name: 'Bobur', group: 'online' as const, income: 5_000_000, salesCount: 4 },
      { name: 'Ali', group: 'online' as const, income: 5_000_000, salesCount: 4 },
    ], 'online');

    expect(ranked.map((agent) => agent.name)).toEqual(['Ali', 'Bobur', 'Zafar']);
  });
});
