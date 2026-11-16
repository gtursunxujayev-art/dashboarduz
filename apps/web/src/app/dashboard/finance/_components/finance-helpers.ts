export const AGENT_ROLES = new Set(['Agent', 'OnlineAgent', 'OfflineAgent']);

export function formatCompactAmount(value: number | null | undefined): string {
  const safe = Number(value || 0);
  const abs = Math.abs(safe);
  if (abs >= 1_000_000_000) {
    return `${(safe / 1_000_000_000).toFixed(1)} mlrd`;
  }
  if (abs >= 1_000_000) {
    return `${(safe / 1_000_000).toFixed(1)} mln`;
  }
  if (abs >= 1_000) {
    return `${(safe / 1_000).toFixed(1)} ming`;
  }
  return `${Math.round(safe)}`;
}

export function getTrendMeta(direction?: string) {
  if (direction === 'up') {
    return {
      badgeClass: 'bg-emerald-100 text-emerald-800',
      label: "O'sish",
      sign: '+',
    };
  }
  if (direction === 'down') {
    return {
      badgeClass: 'bg-red-100 text-red-800',
      label: 'Pasayish',
      sign: '',
    };
  }
  return {
    badgeClass: 'bg-gray-100 text-gray-700',
    label: "O'zgarish yo'q",
    sign: '',
  };
}
