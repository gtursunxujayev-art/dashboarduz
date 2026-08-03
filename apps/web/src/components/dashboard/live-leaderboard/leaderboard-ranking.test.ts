import { describe, expect, it } from '@jest/globals';
import { sortAgentsByOverallMonth } from './leaderboard-ranking';

describe('original live leaderboard ranking', () => {
  it('uses overall monthly income, sales, and name without considering course metrics', () => {
    const ranked = sortAgentsByOverallMonth([
      {
        name: 'Ali',
        group: 'online' as const,
        monthlyIncome: 4_000_000,
        monthlySalesCount: 10,
        courseMetrics: [{ qualifyingIncome: 99_000_000, bonus: 9_900_000 }],
      },
      {
        name: 'Bobur',
        group: 'online' as const,
        monthlyIncome: 6_000_000,
        monthlySalesCount: 2,
        courseMetrics: [{ qualifyingIncome: 1, bonus: 1 }],
      },
      {
        name: 'Dilshod',
        group: 'offline' as const,
        monthlyIncome: 20_000_000,
        monthlySalesCount: 20,
        courseMetrics: [{ qualifyingIncome: 20_000_000, bonus: 2_000_000 }],
      },
    ], 'online');

    expect(ranked.map((agent) => agent.name)).toEqual(['Bobur', 'Ali']);
  });

  it('uses sales and then name as stable tie breakers', () => {
    const ranked = sortAgentsByOverallMonth([
      { name: 'Zafar', group: 'online' as const, monthlyIncome: 5_000_000, monthlySalesCount: 3 },
      { name: 'Bobur', group: 'online' as const, monthlyIncome: 5_000_000, monthlySalesCount: 4 },
      { name: 'Ali', group: 'online' as const, monthlyIncome: 5_000_000, monthlySalesCount: 4 },
    ], 'online');

    expect(ranked.map((agent) => agent.name)).toEqual(['Ali', 'Bobur', 'Zafar']);
  });
});
