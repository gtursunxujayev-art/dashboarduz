import type { ReactNode } from 'react';
import { IconInbox } from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';

/** Shown in place of a list or table that has nothing to show. */
export function EmptyState({
  title,
  description,
  icon: StateIcon = IconInbox,
  action,
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: Icon;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-[12px] border border-dashed border-gray-200 px-6 py-10 text-center ${className}`}>
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-500">
        <StateIcon className="h-5 w-5" stroke={1.6} />
      </span>
      <p className="mt-3 text-sm font-medium text-gray-700">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-gray-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
