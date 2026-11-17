import type { ReactNode } from 'react';

/**
 * Top of every inner page: the page title and a one-line description on the left,
 * the page's primary actions on the right. No card around it.
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Extra content under the title row, such as tabs. */
  children?: ReactNode;
}) {
  return (
    <header className="space-y-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-[28px] sm:leading-tight">{title}</h1>
          {description ? <p className="mt-1.5 max-w-[70ch] text-sm text-gray-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
