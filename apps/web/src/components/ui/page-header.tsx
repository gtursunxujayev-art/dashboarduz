import type { ReactNode } from 'react';

/**
 * Top of every inner page: the page title and a one-line description on the left,
 * the page's primary actions on the right. When the actions do not fit beside the title
 * (wide filter bars), they wrap onto their own row instead of squeezing the title.
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
    <header className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-[min(100%,16rem)] flex-shrink-0">
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-gray-900 sm:text-[32px]">{title}</h1>
          {description ? <p className="mt-1.5 max-w-[70ch] text-[15px] text-gray-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
