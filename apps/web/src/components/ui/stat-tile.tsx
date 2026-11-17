import type { ReactNode } from 'react';
import type { Icon } from '@tabler/icons-react';

const TONES = {
  neutral: { icon: 'bg-gray-100 text-gray-700', value: 'text-gray-900' },
  blue: { icon: 'bg-blue-50 text-blue-600', value: 'text-gray-900' },
  green: { icon: 'bg-emerald-50 text-emerald-600', value: 'text-emerald-700' },
  amber: { icon: 'bg-amber-50 text-amber-600', value: 'text-amber-700' },
  red: { icon: 'bg-red-50 text-red-600', value: 'text-red-700' },
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
    <div className={`panel flex items-start gap-3.5 p-4 sm:p-5 ${className}`}>
      {TileIcon ? (
        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] ${colors.icon}`}>
          <TileIcon className="h-5 w-5" stroke={1.6} />
        </span>
      ) : null}
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-gray-500">{label}</p>
        <p className={`tabular mt-1 break-words text-2xl font-semibold leading-tight tracking-tight ${colors.value}`}>{value}</p>
        {hint ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
      </div>
    </div>
  );
}
