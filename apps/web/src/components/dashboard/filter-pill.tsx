import type { ReactNode } from 'react';
import type { Icon } from '@tabler/icons-react';

/**
 * A labelled filter control for a page toolbar: the label and the control share one pill, so a
 * row of filters reads as a single calm toolbar. Pass a native input or select styled with
 * `pillControlClass` as the child; clicking the label focuses it.
 */
export function FilterPill({
  label,
  icon: PillIcon,
  children,
  className = '',
}: {
  label?: ReactNode;
  icon?: Icon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={`inline-flex h-10 min-w-0 max-w-full items-center gap-2 rounded-full bg-white pl-4 pr-1 shadow focus-within:ring-2 focus-within:ring-blue-500/30 ${className}`}
    >
      {PillIcon ? <PillIcon className="h-4 w-4 flex-shrink-0 text-gray-400" stroke={1.8} aria-hidden="true" /> : null}
      {label ? <span className="flex-shrink-0 whitespace-nowrap text-[13px] font-medium text-gray-500">{label}</span> : null}
      {children}
    </label>
  );
}

/** The bare native control inside a FilterPill. */
export const pillControlClass =
  'tabular h-8 min-w-0 flex-1 rounded-full border-0 bg-transparent px-2 text-sm font-medium text-gray-900 focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-gray-400';
