'use client';

import { IconArrowRight, IconCalendar, IconChevronDown } from '@tabler/icons-react';
import type { ExtendedDashboardRange as DashboardRange } from '@/lib/date-range';

export const FINANCE_RANGE_OPTIONS: { value: DashboardRange; label: string }[] = [
  { value: 'today', label: 'Bugun' },
  { value: 'week', label: 'Hafta' },
  { value: 'month', label: 'Oy' },
  { value: 'last_week', label: "O'tgan hafta" },
  { value: 'last_month', label: "O'tgan oy" },
  { value: 'custom', label: 'Ixtiyoriy' },
];

type Props = {
  range: DashboardRange;
  onRangeChange: (range: DashboardRange) => void;
  dateFrom: string;
  dateTo: string;
  effectiveDateFrom: string;
  effectiveDateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  courseId: string;
  onCourseChange: (value: string) => void;
  courseOptions: { id: string; name: string }[];
  /** Hidden for agent-only users: they only ever see their own numbers. */
  showManagerFilter: boolean;
  managerUserId: string;
  onManagerChange: (value: string) => void;
  managerOptions: { id: string; label: string }[];
};

const PILL_FIELD = 'field h-10 rounded-full bg-white shadow-sm';

/** The one toolbar row of the finance pages: period presets, the covered dates, course and agent filters. */
export function FinanceFilterBar({
  range,
  onRangeChange,
  dateFrom,
  dateTo,
  effectiveDateFrom,
  effectiveDateTo,
  onDateFromChange,
  onDateToChange,
  courseId,
  onCourseChange,
  courseOptions,
  showManagerFilter,
  managerUserId,
  onManagerChange,
  managerOptions,
}: Props) {
  const isCustom = range === 'custom';

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="-mx-1 max-w-full overflow-x-auto px-1 py-0.5">
        <div className="segmented" role="group" aria-label="Davr">
          {FINANCE_RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onRangeChange(option.value)}
              aria-pressed={range === option.value}
              className={range === option.value ? 'segmented-item segmented-item-active' : 'segmented-item'}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`flex min-w-0 items-center gap-1 rounded-full bg-white p-1 shadow ${isCustom ? 'ring-2 ring-inset ring-blue-500/50' : ''}`}
      >
        <div className="relative">
          <IconCalendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
          <input
            type="date"
            value={isCustom ? dateFrom : effectiveDateFrom}
            disabled={!isCustom}
            onChange={(event) => onDateFromChange(event.target.value)}
            className="tabular h-8 w-[10.75rem] rounded-full border-0 bg-transparent pl-9 pr-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/25 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-gray-500"
          />
        </div>
        <IconArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" stroke={1.8} aria-hidden="true" />
        <input
          type="date"
          value={isCustom ? dateTo : effectiveDateTo}
          disabled={!isCustom}
          onChange={(event) => onDateToChange(event.target.value)}
          className="tabular h-8 w-[9rem] rounded-full border-0 bg-transparent px-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/25 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-gray-500"
        />
      </div>

      <div className="relative min-w-[11rem] flex-1 sm:flex-none">
        <select
          value={courseId}
          onChange={(event) => onCourseChange(event.target.value)}
          className={`${PILL_FIELD} appearance-none pr-9`}
        >
          <option value="">Barcha kurslar</option>
          {courseOptions.map((course) => (
            <option key={course.id} value={course.id}>{course.name}</option>
          ))}
        </select>
        <IconChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
      </div>

      {showManagerFilter ? (
        <div className="relative min-w-[11rem] flex-1 sm:flex-none">
          <select
            value={managerUserId}
            onChange={(event) => onManagerChange(event.target.value)}
            className={`${PILL_FIELD} appearance-none pr-9`}
          >
            <option value="">Barcha agentlar</option>
            {managerOptions.map((manager) => (
              <option key={manager.id} value={manager.id}>{manager.label}</option>
            ))}
          </select>
          <IconChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
        </div>
      ) : null}
    </div>
  );
}
