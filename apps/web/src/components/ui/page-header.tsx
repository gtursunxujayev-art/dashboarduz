'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePageTitleSlot } from '@/components/ui/page-title-slot';

/**
 * Top of every inner page. Inside the dashboard shell the title is shown in the top bar;
 * the description and the page's primary actions sit in the first row of the page. When the
 * actions do not fit beside the description they wrap onto their own row.
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
  /** Extra content under the title row, such as tabs or filters. */
  children?: ReactNode;
}) {
  const slot = usePageTitleSlot();
  const inlineTitle = !slot.available;

  const titleInBar = slot.available && slot.element
    ? createPortal(
      <h1 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.02em] text-gray-900 sm:text-[26px]">{title}</h1>,
      slot.element,
    )
    : null;

  const hasTopRow = inlineTitle || description || actions;

  return (
    <header className="space-y-5">
      {titleInBar}
      {hasTopRow ? (
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          {inlineTitle || description ? (
            <div className="min-w-[min(100%,16rem)] flex-shrink-0">
              {inlineTitle ? (
                <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-gray-900 sm:text-[32px]">{title}</h1>
              ) : null}
              {description ? <p className={`${inlineTitle ? 'mt-1.5' : ''} max-w-[70ch] text-[15px] text-gray-500`}>{description}</p> : null}
            </div>
          ) : null}
          {actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </header>
  );
}
