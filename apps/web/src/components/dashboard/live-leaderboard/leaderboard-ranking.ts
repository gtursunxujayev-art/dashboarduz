export type OverallLeaderboardAgent = {
  userId?: string;
  name: string;
  group: 'online' | 'offline';
  income: number;
  salesCount: number;
};

export function sortAgentsForBoard<T extends OverallLeaderboardAgent>(
  agents: T[],
  group: OverallLeaderboardAgent['group'],
): T[] {
  return agents
    .filter((agent) => agent.group === group)
    .sort((left, right) => (
      right.income - left.income
      || right.salesCount - left.salesCount
      || left.name.localeCompare(right.name)
      || String(left.userId ?? '').localeCompare(String(right.userId ?? ''))
    ));
}
