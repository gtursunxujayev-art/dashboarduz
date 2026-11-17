import type { ReactNode } from 'react';
import type { Icon } from '@tabler/icons-react';

const TONES = {
  neutral: { icon: 'bg-gray-100 text-gray-600', value: 'text-gray-900', bar: 'bg-gray-300' },
  blue: { icon: 'bg-blue-50 text-blue-600', value: 'text-gray-900', bar: 'bg-blue-600' },
  green: { icon: 'bg-emerald-50 text-emerald-600', value: 'text-emerald-700', bar: 'bg-emerald-500' },
  amber: { icon: 'bg-amber-50 text-amber-600', value: 'text-amber-700', bar: 'bg-amber-500' },
  red: { icon: 'bg-red-50 text-red-600', value: 'text-red-700', bar: 'bg-red-500' },
} as const;

export type StatTone = keyof typeof TONES;

/** A single KPI: label, large value, optional icon and hint. Use in a grid of 2-4. */
export function StatTile({
  label,
  value,
  hint,
  icon: TileIcon,
  tone = 'neutral',
  className = '',
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: Icon;
  tone?: StatTone;
  className?: string;
}) {
  const colors = TONES[tone];
  return (
    <div className={`panel relative flex min-w-0 flex-col justify-between gap-2 overflow-hidden px-4 py-3.5 ${className}`}>
      <span aria-hidden="true" className={`absolute inset-y-3.5 left-0 w-[3px] rounded-r-full ${colors.bar}`} />
      <div className="flex items-center justify-between gap-3">
        <p className="caption leading-snug">{label}</p>
        {TileIcon ? (
          <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${colors.icon}`}>
            <TileIcon className="h-4 w-4" stroke={1.7} />
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        <p className={`tabular break-words text-[22px] font-semibold leading-tight tracking-[-0.02em] ${colors.value}`}>{value}</p>
        {hint ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
      </div>
    </div>
  );
}
