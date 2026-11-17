import { type ManagerGroup, shiftToTashkent, TASHKENT_TIMEZONE_LABEL } from '@dashboarduz/shared';

import { humanizeKey } from '../../integrations/amocrm-live';

import type { ReportManagerRow, ReportMetrics } from './types';

export function formatLocalDateTime(date: Date): string {
  const local = shiftToTashkent(date);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  const hour = String(local.getUTCHours()).padStart(2, '0');
  const minute = String(local.getUTCMinutes()).padStart(2, '0');
  const second = String(local.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${TASHKENT_TIMEZONE_LABEL}`;
}

export function formatCompactCurrency(value: number): string {
  const rounded = Math.round(value);
  const abs = Math.abs(rounded);

  if (abs >= 1_000_000_000) {
    return `${(rounded / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 1 : 2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${(rounded / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  }
  if (abs >= 1_000) {
    return `${(rounded / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  }

  return String(rounded);
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatClockHoursMinutes(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatSelectedCourseLine(row: ReportMetrics['selectedCourseRows'][number]): string {
  const tariffs = row.tariffBreakdown.length > 0
    ? row.tariffBreakdown
      .slice(0, 4)
      .map((item) => `${item.label}: ${item.value}`)
      .join(' | ')
    : 'Tariflar: 0';

  return `${row.courseName}: Sotuv - ${row.salesCount} | ${tariffs}`;
}

export function getReportTenantName(value: string | null | undefined): string {
  const normalized = String(value || '').trim();

  return normalized || 'Workspace';
}

function topBreakdownRows(entries: Array<{ label: string; value: number }>, fallbackLabel: string): string[] {
  if (!entries.length) {
    return [`${fallbackLabel}: 0`];
  }

  return entries.map((entry) => {
    const normalizedLabel = entry.label.trim().length > 0
      ? humanizeKey(entry.label)
      : fallbackLabel;

    return `${normalizedLabel}: ${entry.value}`;
  });
}

function fitTwoColumnThreeRows(lines: string[]): { left: string[]; right: string[] } {
  const items = lines.length > 0 ? lines : ["Ma'lumot yo'q: 0"];
  const half = Math.ceil(items.length / 2);
  const leftRaw = items.slice(0, half);
  const rightRaw = items.slice(half);

  const fitColumn = (columnItems: string[]): string[] => {
    if (columnItems.length <= 3) {
      return columnItems;
    }

    return [
      columnItems[0] || '-',
      columnItems[1] || '-',
      columnItems.slice(2).join(' | '),
    ];
  };

  return {
    left: fitColumn(leftRaw),
    right: fitColumn(rightRaw),
  };
}

export function getBreakdownLayout(entries: Array<{ label: string; value: number }>): {
  left: string[];
  right: string[];
  rowCount: number;
  height: number;
} {
  const lines = topBreakdownRows(entries, "Ma'lumot yo'q");
  const grid = fitTwoColumnThreeRows(lines);
  const rowCount = Math.max(1, grid.left.length, grid.right.length);

  return {
    ...grid,
    rowCount,
    height: 28 + rowCount * 14 + 8,
  };
}

export function classifyManagerGroup(roles: readonly string[] | null | undefined): ManagerGroup | null {
  if (roles?.includes('OnlineAgent')) {
    return 'online';
  }
  // Team leaders are listed with the offline managers.
  if (roles?.includes('OfflineAgent') || roles?.includes('TeamLeader')) {
    return 'offline';
  }

  return null;
}

export function compareManagerRows(a: ReportManagerRow, b: ReportManagerRow): number {
  if (b.sales !== a.sales) return b.sales - a.sales;
  if (b.leads !== a.leads) return b.leads - a.leads;

  return a.name.localeCompare(b.name);
}

export function groupManagerRows(rows: ReportManagerRow[]): Array<{
  group: ManagerGroup;
  label: string;
  rows: ReportManagerRow[];
}> {
  const groups: Array<{ group: ManagerGroup; label: string }> = [
    { group: 'online', label: 'Online agentlar' },
    { group: 'offline', label: 'Offline agentlar' },
  ];

  return groups
    .map((entry) => ({
      ...entry,
      rows: rows.filter((row) => row.group === entry.group).sort(compareManagerRows),
    }))
    .filter((entry) => entry.rows.length > 0);
}

export function isLostLeadStatus(value: unknown): boolean {
  return String(value || '').trim() === '143';
}
