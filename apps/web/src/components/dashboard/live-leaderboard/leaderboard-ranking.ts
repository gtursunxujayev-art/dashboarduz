export type OverallLeaderboardAgent = {
  name: string;
  group: 'online' | 'offline';
  monthlyIncome: number;
  monthlySalesCount: number;
};

export function sortAgentsByOverallMonth<T extends OverallLeaderboardAgent>(
  agents: T[],
  group: OverallLeaderboardAgent['group'],
): T[] {
  return agents
    .filter((agent) => agent.group === group)
    .sort((left, right) => (
      right.monthlyIncome - left.monthlyIncome
      || right.monthlySalesCount - left.monthlySalesCount
      || left.name.localeCompare(right.name)
    ));
}
